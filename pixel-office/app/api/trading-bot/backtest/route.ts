export const runtime = "nodejs";
export const maxDuration = 60; // mirrors the explicit vercel.json override

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/current-user";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { toErrorResponse, BadRequest } from "@/lib/api/errors";
import { raceWithDeadline } from "@/lib/api/deadline";
import { SYMBOL_WHITELIST, SUPPORTED_SYMBOLS } from "@/lib/trading-signals/config";
import { fetchBacktestHistory } from "@/lib/market-data/historical-candles";
import { normalizeRange, TIMEFRAME_DURATION_MS_4H } from "@/lib/backtest/candle-window";
import { runBacktest } from "@/lib/backtest/run-backtest";
import { validateCandles, checkCoverage } from "@/lib/backtest/validate-candles";
import { assembleBacktestResult, serializeForResponse } from "@/lib/backtest/serialize";
import { CONFIG_BOUNDS, MAX_REQUESTED_RANGE_DAYS } from "@/lib/backtest/config";

// Internal budget stays strictly under the route's explicit 60s vercel.json
// maxDuration, leaving headroom to serialize and respond after the fetch/simulate
// work completes or is aborted.
const INTERNAL_DEADLINE_MS = 55_000;
const ONE_DAY_MS = 86_400_000;
const ONE_HOUR_MS = 3_600_000;

const requestSchema = z.object({
  symbol: z.enum(SUPPORTED_SYMBOLS as [string, ...string[]]),
  requestedStart: z.number().int(),
  requestedEnd: z.number().int(),
  initialBalance: z.number().min(CONFIG_BOUNDS.initialBalance.min).max(CONFIG_BOUNDS.initialBalance.max).default(10000),
  feeRate: z.number().min(CONFIG_BOUNDS.feeRate.min).max(CONFIG_BOUNDS.feeRate.max).default(0.001),
  spreadBps: z.number().min(CONFIG_BOUNDS.spreadBps.min).max(CONFIG_BOUNDS.spreadBps.max).default(5),
  slippageBps: z.number().min(CONFIG_BOUNDS.slippageBps.min).max(CONFIG_BOUNDS.slippageBps.max).default(5),
});

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "backtestRun");

    const body = await request.json();
    const input = requestSchema.parse(body);

    if (input.requestedEnd <= input.requestedStart) {
      throw new BadRequest("requestedEnd must be after requestedStart");
    }
    const rangeDays = (input.requestedEnd - input.requestedStart) / ONE_DAY_MS;
    if (rangeDays < 1 || rangeDays > MAX_REQUESTED_RANGE_DAYS) {
      throw new BadRequest(`Range must be between 1 and ${MAX_REQUESTED_RANGE_DAYS} days`);
    }

    // Symbol -> exchange ticker comes ONLY from the server-side whitelist map. No
    // request field is ever used to build the provider URL directly.
    const ticker = SYMBOL_WHITELIST[input.symbol];

    // One shared controller: the internal deadline's onTimeout aborts it, and that
    // abort propagates into every in-flight and future paginated fetch (see
    // fetchPage's onExternalAbort listener in historical-candles.ts) — a timeout
    // here actually stops network requests, it does not just return early while they
    // continue in the background.
    const controller = new AbortController();
    request.signal.addEventListener("abort", () => controller.abort());

    // latestFullyClosedBarBoundary MUST be 4h-grid-aligned — normalizeRange's
    // effectiveEndBoundary feeds isTradableBar's closeTime<=effectiveEndBoundary check
    // (candle-window.ts, Task 5), so an unaligned raw Date.now() here would silently
    // break the tradable-bar boundary math. Floor to the grid first.
    const latestFullyClosedBarBoundary = Math.floor(Date.now() / TIMEFRAME_DURATION_MS_4H) * TIMEFRAME_DURATION_MS_4H;
    const window = normalizeRange(input.requestedStart, input.requestedEnd, latestFullyClosedBarBoundary);

    const bundle = await raceWithDeadline(
      fetchBacktestHistory(ticker, window.normalizedStart, window.normalizedEnd, controller.signal),
      INTERNAL_DEADLINE_MS,
      () => {
        controller.abort();
        return null;
      },
    );
    if (bundle === null || bundle.primary.failed || bundle.oneHour.failed || bundle.oneDay.failed) {
      throw new BadRequest("Historical data fetch failed or timed out");
    }

    const { candles: validatedPrimary, report: primaryReport } = validateCandles(bundle.primary.candles, TIMEFRAME_DURATION_MS_4H);
    if (primaryReport.conflictingDuplicateCount > 0) {
      throw new BadRequest("Conflicting duplicate candles detected in primary data — refusing to run");
    }
    if (validatedPrimary.length < 60) {
      throw new BadRequest("Insufficient warm-up history for the requested range");
    }

    const primaryCoverage = checkCoverage(
      validatedPrimary,
      window.normalizedStart - 60 * TIMEFRAME_DURATION_MS_4H,
      window.normalizedEnd - 1,
      TIMEFRAME_DURATION_MS_4H,
    );

    const config = {
      spreadBps: input.spreadBps,
      slippageBps: input.slippageBps,
      feeRate: new Prisma.Decimal(input.feeRate),
      initialBalance: new Prisma.Decimal(input.initialBalance),
      finalize: true,
    };

    const runResult = runBacktest(validatedPrimary, bundle.oneHour.candles, bundle.oneDay.candles, window, config);

    const result = assembleBacktestResult({
      engineVersion: "phase3-v1",
      symbol: input.symbol,
      requestedRange: { start: input.requestedStart, end: input.requestedEnd },
      fetchedWarmupRange: {
        primary: { start: window.normalizedStart - 60 * TIMEFRAME_DURATION_MS_4H, end: window.normalizedEnd },
        oneHour: { start: window.normalizedStart - 50 * ONE_HOUR_MS, end: window.normalizedEnd },
        oneDay: { start: window.normalizedStart - 50 * ONE_DAY_MS, end: window.normalizedEnd },
      },
      actualEvaluationRange: { start: window.normalizedStart, end: window.effectiveEndBoundary },
      candleCounts: {
        primary: validatedPrimary.length,
        oneHour: bundle.oneHour.candles.length,
        oneDay: bundle.oneDay.candles.length,
      },
      configEcho: {
        initialBalance: config.initialBalance.toString(),
        feeRate: config.feeRate.toString(),
        spreadBps: config.spreadBps,
        slippageBps: config.slippageBps,
        riskPerTradeFraction: "0.005",
      },
      dataQuality: { malformedCount: bundle.primary.malformedCount, ...primaryReport, coverageShortfall: primaryCoverage },
      runResult,
      extraWarnings: bundle.primary.truncated
        ? ["Primary candle pagination truncated at the page cap — results may reflect a shorter-than-requested range."]
        : [],
    });

    const serialized = serializeForResponse(result);
    if (!serialized.ok) {
      return NextResponse.json({ error: "RESPONSE_TOO_LARGE" }, { status: 413 });
    }
    return new NextResponse(serialized.body, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    // toErrorResponse never echoes stack traces or the raw request body/result — it
    // maps to a fixed, generic message per error class and redacts secrets from
    // whatever it does log for truly unhandled errors.
    return toErrorResponse(err);
  }
}
