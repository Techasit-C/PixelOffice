import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { runBacktest } from "@/lib/backtest/run-backtest";
import type { EvaluationWindow } from "@/lib/backtest/candle-window";

const H4 = 14_400_000;

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

describe("the final tradable bar is always present — the corrected §6.3 boundary model", () => {
  const normalizedStart = 60 * H4;
  const normalizedEnd = 65 * H4; // exactly 5 tradable bars: B,C,D,E,F
  const window: EvaluationWindow = { normalizedStart, normalizedEnd, effectiveEndBoundary: normalizedEnd };
  const primary = buildSeries(65, 0, H4);
  const oneHour = buildSeries(2000, 0 - 50 * 3_600_000, 3_600_000, 50);
  const oneDay = buildSeries(120, 0 - 50 * 86_400_000, 86_400_000, 200);

  const config = {
    spreadBps: 5, slippageBps: 5, feeRate: new Prisma.Decimal("0.001"),
    initialBalance: new Prisma.Decimal("10000"), finalize: true,
  };

  it("the equity curve's last point is exactly at effectiveEndBoundary, not four hours earlier", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    const last = result.simulate.equityCurve[result.simulate.equityCurve.length - 1];
    expect(last.time).toBe(normalizedEnd);
  });

  it("the benchmark's exit is also exactly at effectiveEndBoundary", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    expect(result.benchmark.exitTime).toBe(normalizedEnd);
  });

  it("no ENTRY_PROCESSED event ever occurs at or after effectiveEndBoundary", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    const lateEntries = result.simulate.events.filter((e) => e.type === "ENTRY_PROCESSED" && e.time >= normalizedEnd);
    expect(lateEntries).toEqual([]);
  });
});
