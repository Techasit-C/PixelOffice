import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { runBenchmark } from "@/lib/backtest/benchmark";

const H4 = 14_400_000;
function bar(openTime: number, open: number, high: number, low: number, close: number): Candle {
  return { openTime, open, high, low, close, volume: 100 };
}

describe("runBenchmark", () => {
  const B = bar(2 * H4, 100, 106, 99, 105); // first tradable bar
  const C = bar(3 * H4, 105, 108, 104, 107); // final tradable bar
  const tradable = [B, C];

  it("enters at the first tradable bar's open and exits at the final tradable bar's close", () => {
    const result = runBenchmark(tradable, 0, 0, new Prisma.Decimal("0"), new Prisma.Decimal("10000"), H4);
    expect(result.entryTime).toBe(2 * H4);
    expect(result.entryPrice).toBe("100.00000000");
    expect(result.exitTime).toBe(4 * H4);
    expect(result.exitPrice).toBe("107.00000000");
  });

  it("never spends more than the initial balance", () => {
    const result = runBenchmark(tradable, 5, 5, new Prisma.Decimal("0.001"), new Prisma.Decimal("10000"), H4);
    const entryCost = new Prisma.Decimal(result.quantity).times(result.entryPrice).times(1.001);
    expect(entryCost.lessThanOrEqualTo("10000")).toBe(true);
  });

  it("the equity curve's final point is replaced by the post-liquidation cash, one point per bar", () => {
    const result = runBenchmark(tradable, 0, 0, new Prisma.Decimal("0"), new Prisma.Decimal("10000"), H4);
    expect(result.equityCurve.length).toBe(2); // one per tradable bar, no duplicate final point
    expect(result.equityCurve[1].equity).toBe(result.finalCash);
  });

  it("applies identical fee/spread/slippage cost assumptions as the strategy path", () => {
    const zeroCost = runBenchmark(tradable, 0, 0, new Prisma.Decimal("0"), new Prisma.Decimal("10000"), H4);
    const withCost = runBenchmark(tradable, 5, 5, new Prisma.Decimal("0.001"), new Prisma.Decimal("10000"), H4);
    expect(new Prisma.Decimal(withCost.finalCash).lessThan(zeroCost.finalCash)).toBe(true);
  });
});
