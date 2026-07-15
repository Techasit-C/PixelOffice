// Regression test for the warm-up invariant flagged during Checkpoint 4 recovery:
// the simulation loop only ITERATES evaluation/tradable bars, but every call to
// buildSignalFromCandles() at a decision bar must still receive the complete closed
// primary pre-roll (PRIMARY_WARMUP_BARS) and closed 1h/1d confirmation pre-roll
// (CONFIRMATION_WARMUP_BARS) available as of that bar's analysisNow — never a primary
// array trimmed to just the evaluation range.
import { describe, it, expect, vi, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import * as engine from "@/lib/trading-signals/engine";
import { runBacktest } from "@/lib/backtest/run-backtest";
import {
  PRIMARY_WARMUP_BARS,
  CONFIRMATION_WARMUP_BARS,
  TIMEFRAME_DURATION_MS_4H,
  primaryFetchWindow,
  oneHourFetchWindow,
  oneDayFetchWindow,
  type EvaluationWindow,
} from "@/lib/backtest/candle-window";

const H1 = 3_600_000;
const D1 = 86_400_000;

function buildSeries(count: number, startOpenTime: number, durationMs: number, seed = 100): Candle[] {
  const candles: Candle[] = [];
  let price = seed;
  for (let i = 0; i < count; i++) {
    const openTime = startOpenTime + i * durationMs;
    const open = price;
    price += 0.5;
    const close = price;
    candles.push({ openTime, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume: 100 });
  }
  return candles;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("warm-up invariant — the first eligible decision bar receives full pre-roll history", () => {
  const normalizedStart = 200 * TIMEFRAME_DURATION_MS_4H;
  const normalizedEnd = normalizedStart + 5 * TIMEFRAME_DURATION_MS_4H; // 5 evaluation bars
  const window: EvaluationWindow = { normalizedStart, normalizedEnd, effectiveEndBoundary: normalizedEnd };

  // Fixtures built from the EXACT same fetch-window math production wiring uses —
  // this is what a real fetch would hand to runBacktest, no extra padding.
  const primaryWindow = primaryFetchWindow(normalizedStart, normalizedEnd);
  const primaryBarCount = Math.round((normalizedEnd - primaryWindow.fetchStartTime) / TIMEFRAME_DURATION_MS_4H);
  const primary = buildSeries(primaryBarCount, primaryWindow.fetchStartTime, TIMEFRAME_DURATION_MS_4H);

  const oneHourWindow = oneHourFetchWindow(normalizedStart, normalizedEnd);
  const oneHourBarCount = Math.round((normalizedEnd - oneHourWindow.fetchStartTime) / H1);
  const oneHour = buildSeries(oneHourBarCount, oneHourWindow.fetchStartTime, H1, 50);

  const oneDayWindow = oneDayFetchWindow(normalizedStart, normalizedEnd);
  const oneDayBarCount = Math.round((normalizedEnd - oneDayWindow.fetchStartTime) / D1);
  const oneDay = buildSeries(oneDayBarCount, oneDayWindow.fetchStartTime, D1, 200);

  const config = {
    spreadBps: 5, slippageBps: 5, feeRate: new Prisma.Decimal("0.001"),
    initialBalance: new Prisma.Decimal("10000"), finalize: false,
  };

  it("passes exactly PRIMARY_WARMUP_BARS closed primary candles and the full closed confirmation pre-roll on the first decision", () => {
    const spy = vi.spyOn(engine, "buildSignalFromCandles");
    runBacktest(primary, oneHour, oneDay, window, config);

    expect(spy).toHaveBeenCalled();
    const [firstSeriesArg, firstGeneratedAt, firstConfirmationArg] = spy.mock.calls[0];
    const analysisNow = Date.parse(firstGeneratedAt);

    // The very first decision bar closes exactly at normalizedStart (the decision-only
    // bar from §6.3 — closeTime === normalizedStart, openTime === normalizedStart - H4).
    expect(analysisNow).toBe(normalizedStart);

    // Never a primary array trimmed to the evaluation range: exactly the 60-bar warm-up
    // plus the decision bar itself, all strictly closed as of analysisNow.
    expect(firstSeriesArg.candles.length).toBe(PRIMARY_WARMUP_BARS);
    expect(firstSeriesArg.candles.every((c: Candle) => c.openTime + TIMEFRAME_DURATION_MS_4H <= analysisNow)).toBe(true);

    // Confirmation candles are handed through unfiltered (buildSignalFromCandles does
    // its own analysisNow-based closed-candle filtering internally) — but the closed
    // subset available as of analysisNow must already meet CONFIRMATION_WARMUP_BARS.
    const closedOneHour = firstConfirmationArg.oneHourCandles.filter((c: Candle) => c.openTime + H1 <= analysisNow);
    const closedOneDay = firstConfirmationArg.oneDayCandles.filter((c: Candle) => c.openTime + D1 <= analysisNow);
    expect(closedOneHour.length).toBe(CONFIRMATION_WARMUP_BARS);
    expect(closedOneDay.length).toBe(CONFIRMATION_WARMUP_BARS);
  });

  it("future primary candles strictly after the decision bar are never present in its closedPrimaryCandles argument", () => {
    const spy = vi.spyOn(engine, "buildSignalFromCandles");
    runBacktest(primary, oneHour, oneDay, window, config);

    for (const call of spy.mock.calls) {
      const [seriesArg, generatedAtArg] = call;
      const analysisNow = Date.parse(generatedAtArg);
      for (const c of seriesArg.candles as Candle[]) {
        expect(c.openTime + TIMEFRAME_DURATION_MS_4H).toBeLessThanOrEqual(analysisNow);
      }
    }
  });
});
