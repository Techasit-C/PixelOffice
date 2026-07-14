import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { computeMetrics } from "@/lib/backtest/metrics";
import type { EquityPoint, TradeLedgerEntry } from "@/lib/backtest/types";

function trade(pnl: string): TradeLedgerEntry {
  return {
    entryTime: 0, entryPrice: "100", quantity: "1", entryNotional: "100", entryFee: "0",
    entryCost: "100", exitTime: 1, exitPrice: "100", exitReason: "STOP", exitNotional: "100",
    exitFee: "0", exitProceeds: "100", realizedPnl: pnl, intendedRiskBudget: "0",
    actualNetRisk: "0", actualRiskFraction: 0, cashCapped: false, netRiskReward: 0, warnings: [],
  };
}
function point(time: number, equity: string): EquityPoint {
  return { time, equity };
}

const initialBalance = new Prisma.Decimal("10000");

describe("computeMetrics — net profit and total return", () => {
  it("computes net profit as final equity minus initial balance", () => {
    const curve = [point(0, "10000"), point(1, "11000")];
    const m = computeMetrics(curve, [], initialBalance);
    expect(m.netProfit).toBe("1000.00000000");
    expect(m.totalReturn).toBeCloseTo(0.1);
  });
});

describe("computeMetrics — win rate, loss rate, breakeven treatment", () => {
  it("a breakeven trade counts in the denominator of both rates but neither numerator", () => {
    const trades = [trade("100"), trade("-50"), trade("0")];
    const m = computeMetrics([point(0, "10000")], trades, initialBalance);
    expect(m.tradeCount).toBe(3);
    expect(m.winRate).toBeCloseTo(1 / 3);
    expect(m.lossRate).toBeCloseTo(1 / 3);
  });
});

describe("computeMetrics — profit factor", () => {
  it("computes grossProfit/grossLoss when both exist", () => {
    const trades = [trade("100"), trade("-50")];
    const m = computeMetrics([point(0, "10000")], trades, initialBalance);
    expect(m.profitFactor).toBeCloseTo(2);
    expect(m.profitFactorReason).toBeNull();
  });

  it("is null with an explanatory reason when there are zero losing trades", () => {
    const trades = [trade("100"), trade("50")];
    const m = computeMetrics([point(0, "10000")], trades, initialBalance);
    expect(m.profitFactor).toBeNull();
    expect(m.profitFactorReason).toBe("undefined — no losing trades in this run");
  });
});

describe("computeMetrics — average win/loss sign convention", () => {
  it("reports average loss as a POSITIVE magnitude", () => {
    const trades = [trade("-50"), trade("-150")];
    const m = computeMetrics([point(0, "10000")], trades, initialBalance);
    expect(m.averageLoss).toBe("100.00000000"); // (50+150)/2, positive
  });
});

describe("computeMetrics — max drawdown (close-to-close, not intrabar)", () => {
  it("computes the largest peak-to-trough percentage decline", () => {
    const curve = [point(0, "10000"), point(1, "12000"), point(2, "9000"), point(3, "11000")];
    const m = computeMetrics(curve, [], initialBalance);
    expect(m.maxDrawdownPct).toBeCloseTo((12000 - 9000) / 12000);
  });
});

describe("computeMetrics — Sharpe: null on too few points or zero variance", () => {
  it("is null with fewer than two returns", () => {
    const m = computeMetrics([point(0, "10000")], [], initialBalance);
    expect(m.sharpe).toBeNull();
  });

  it("is null when every return is identical (zero variance)", () => {
    const curve = [point(0, "10000"), point(1, "10100"), point(2, "10201")]; // constant 1% growth
    const m = computeMetrics(curve, [], initialBalance);
    expect(m.sharpe).toBeNull();
  });

  it("is a finite positive number for a rising, variable equity curve", () => {
    const curve = [point(0, "10000"), point(1, "10300"), point(2, "10200"), point(3, "10600")];
    const m = computeMetrics(curve, [], initialBalance);
    expect(m.sharpe).not.toBeNull();
    expect(Number.isFinite(m.sharpe)).toBe(true);
  });
});

describe("computeMetrics — expectancy", () => {
  it("computes winRate*avgWin - lossRate*avgLoss", () => {
    const trades = [trade("100"), trade("-50")];
    const m = computeMetrics([point(0, "10000")], trades, initialBalance);
    // winRate=0.5, avgWin=100, lossRate=0.5, avgLoss=50 -> 0.5*100 - 0.5*50 = 25
    expect(m.expectancy).toBe("25.00000000");
  });
});
