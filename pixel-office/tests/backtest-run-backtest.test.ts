import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { runBacktest } from "@/lib/backtest/run-backtest";
import type { EvaluationWindow } from "@/lib/backtest/candle-window";

const H4 = 14_400_000;

// 70 contiguous 4h candles: 60 warm-up bars + 10 evaluation bars, mild uptrend so
// detectSetup() has a real chance of proposing a LONG at some point — deterministic,
// fixed OHLCV, no randomness.
function buildPrimarySeries(count: number, startOpenTime: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const openTime = startOpenTime + i * H4;
    const open = price;
    price = price + 0.5 + (i % 3 === 0 ? 1.5 : 0); // gentle, deterministic uptrend
    const close = price;
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    candles.push({ openTime, open, high, low, close, volume: 100 + i });
  }
  return candles;
}

function buildFlatConfirmation(count: number, startOpenTime: number, durationMs: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const openTime = startOpenTime + i * durationMs;
    candles.push({ openTime, open: 100, high: 101, low: 99, close: 100 + (i % 2), volume: 100 });
  }
  return candles;
}

const config = {
  spreadBps: 5,
  slippageBps: 5,
  feeRate: new Prisma.Decimal("0.001"),
  initialBalance: new Prisma.Decimal("10000"),
  finalize: true,
};

describe("runBacktest — assembles simulate + benchmark + metrics + dataQuality", () => {
  const warmupStart = 0;
  const normalizedStart = 60 * H4;
  const normalizedEnd = 70 * H4;
  const window: EvaluationWindow = { normalizedStart, normalizedEnd, effectiveEndBoundary: normalizedEnd };

  const primary = buildPrimarySeries(70, warmupStart);
  const oneHour = buildFlatConfirmation(200, warmupStart, 3_600_000);
  const oneDay = buildFlatConfirmation(60, warmupStart - 50 * 86_400_000, 86_400_000);

  it("returns a coherent bundle whose benchmark and simulate share the same evaluation range", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    expect(result.benchmark.entryTime).toBe(60 * H4); // firstExecutionBar.open
    expect(result.benchmark.exitTime).toBe(70 * H4); // finalTradableBar.close
    expect(result.simulate.equityCurve[0].time).toBe(60 * H4);
    expect(result.simulate.equityCurve[result.simulate.equityCurve.length - 1].time).toBe(70 * H4);
  });

  it("trims the primary series to exclude any bar opening at/after effectiveEndBoundary before simulating", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    const lastEventTime = Math.max(...result.simulate.events.map((e) => e.time));
    expect(lastEventTime).toBeLessThanOrEqual(70 * H4);
  });

  it("dataQuality reflects the validate-candles pass over the primary series", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    expect(result.dataQuality.gapCount).toBe(0); // fixture is fully contiguous
    expect(result.dataQuality.conflictingDuplicateCount).toBe(0);
  });
});
