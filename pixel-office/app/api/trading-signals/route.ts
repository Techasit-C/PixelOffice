// /api/trading-signals — READ-ONLY, ANALYSIS-ONLY signal feed.
//
// SAFETY INVARIANT: this endpoint is structurally incapable of trading. It imports
// ONLY the analysis engine (which reads public candles) — no exchange client, no
// order/withdraw/transfer/execute path. It returns opinions about levels; it never
// acts on them. Live execution stays disabled.
//
// Shape mirrors /api/crypto-prices: Node runtime; auth + rate-limit FIRST in their
// own try/catch so a 401/429 is never masked; the data work degrades to
// WAIT/insufficient-data rather than 500 when public market data is unavailable.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { generateSignals } from "@/lib/trading-signals/engine";
import { DEFAULT_TIMEFRAME, SUPPORTED_SYMBOLS } from "@/lib/trading-signals/config";
import type { SignalSource, TradingSignal } from "@/lib/trading-signals/types";

// Worst-case rollup: the overall source is the least-trustworthy of any signal, so
// the caller can honestly badge the whole response.
function rollupSource(signals: TradingSignal[]): SignalSource {
  if (signals.some((s) => s.source === "insufficient-data")) return "insufficient-data";
  if (signals.some((s) => s.source === "mock")) return "mock";
  return "analysis";
}

export async function GET() {
  // Auth + rate limit FIRST (reuses the existing `signalsRead` bucket), isolated so
  // a 401/429 is never swallowed by the graceful market-data degrade below.
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "signalsRead");
  } catch (err) {
    return toErrorResponse(err);
  }

  // Engine never throws; missing public candles degrade to WAIT/insufficient-data.
  // We still guard so an unexpected fault becomes an honest empty-but-200 payload
  // rather than a 500 that hides the read-only nature of the endpoint.
  try {
    const signals = await generateSignals(SUPPORTED_SYMBOLS, DEFAULT_TIMEFRAME);
    return NextResponse.json({
      signals,
      generatedAt: new Date().toISOString(),
      source: rollupSource(signals),
    });
  } catch (err) {
    console.error("[trading-signals] unexpected engine fault, degrading:", err);
    const generatedAt = new Date().toISOString();
    const signals: TradingSignal[] = SUPPORTED_SYMBOLS.map((symbol) => ({
      symbol,
      timeframe: DEFAULT_TIMEFRAME,
      direction: "WAIT",
      entryZone: null,
      stopLoss: null,
      takeProfit: [],
      riskRewardRatio: null,
      confidence: 0,
      reasoning: ["Signal engine unavailable — no analysis produced."],
      invalidationCondition: "No actionable setup.",
      generatedAt,
      source: "insufficient-data",
    }));
    return NextResponse.json({ signals, generatedAt, source: "insufficient-data" });
  }
}
