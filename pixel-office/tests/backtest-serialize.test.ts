import { describe, it, expect } from "vitest";
import { assembleBacktestResult, serializeForResponse } from "@/lib/backtest/serialize";
import type { EquityPoint, TradeLedgerEntry } from "@/lib/backtest/types";
import type { RunBacktestResult } from "@/lib/backtest/run-backtest";

function makeRunResult(equityPointCount: number): RunBacktestResult {
  const equityCurve: EquityPoint[] = Array.from({ length: equityPointCount }, (_, i) => ({
    time: i, equity: (10000 + i).toString(),
  }));
  const trades: TradeLedgerEntry[] = [];
  return {
    simulate: { tradeLedger: trades, unexecutedSignals: [], equityCurve, events: [] },
    benchmark: {
      entryTime: 0, entryPrice: "100", quantity: "1", exitTime: 1, exitPrice: "110",
      finalCash: "10100",
      metrics: {
        netProfit: "100", totalReturn: 0.01, winRate: 0, lossRate: 0, profitFactor: null,
        profitFactorReason: "undefined — no losing trades in this run", maxDrawdownPct: 0,
        sharpe: null, tradeCount: 0, averageWin: "0", averageLoss: "0", expectancy: "0",
      },
      equityCurve,
    },
    metrics: {
      netProfit: "100", totalReturn: 0.01, winRate: 0, lossRate: 0, profitFactor: null,
      profitFactorReason: "undefined — no losing trades in this run", maxDrawdownPct: 0,
      sharpe: null, tradeCount: 0, averageWin: "0", averageLoss: "0", expectancy: "0",
    },
    dataQuality: { invalidOhlcCount: 0, exactDuplicateCount: 0, conflictingDuplicateCount: 0, reordered: false, reorderCount: 0, gapCount: 0, gaps: [] },
  };
}

function baseInput(equityPointCount: number) {
  return {
    engineVersion: "phase3-v1",
    symbol: "BTC/USDT",
    requestedRange: { start: 0, end: 100 },
    fetchedWarmupRange: { primary: { start: 0, end: 100 }, oneHour: { start: 0, end: 100 }, oneDay: { start: 0, end: 100 } },
    actualEvaluationRange: { start: 0, end: 100 },
    candleCounts: { primary: 100, oneHour: 100, oneDay: 100 },
    configEcho: { initialBalance: "10000", feeRate: "0.001", spreadBps: 5, slippageBps: 5, riskPerTradeFraction: "0.005" },
    dataQuality: { malformedCount: 0, invalidOhlcCount: 0, exactDuplicateCount: 0, conflictingDuplicateCount: 0, reordered: false, reorderCount: 0, gapCount: 0, gaps: [], coverageShortfall: null },
    runResult: makeRunResult(equityPointCount),
    extraWarnings: [],
  };
}

describe("assembleBacktestResult", () => {
  it("carries the full-resolution equity curve into .equityCurve unchanged", () => {
    const result = assembleBacktestResult(baseInput(10));
    expect(result.equityCurve.length).toBe(10);
  });

  it("downsamples .equityCurveChart to at most 500 points, always including first and last", () => {
    const result = assembleBacktestResult(baseInput(1200));
    expect(result.equityCurveChart.length).toBeLessThanOrEqual(500);
    expect(result.equityCurveChart[0]).toEqual({ time: 0, equity: "10000" });
    expect(result.equityCurveChart[result.equityCurveChart.length - 1]).toEqual({ time: 1199, equity: "11199" });
  });

  it("leaves .equityCurveChart identical to .equityCurve when already under the cap", () => {
    const result = assembleBacktestResult(baseInput(10));
    expect(result.equityCurveChart).toEqual(result.equityCurve);
  });
});

describe("serializeForResponse", () => {
  it("returns ok:true with a valid JSON body under the cap", () => {
    const result = assembleBacktestResult(baseInput(10));
    const serialized = serializeForResponse(result);
    expect(serialized.ok).toBe(true);
    if (serialized.ok) expect(() => JSON.parse(serialized.body)).not.toThrow();
  });

  it("returns RESPONSE_TOO_LARGE when the serialized byte length exceeds the cap", () => {
    const huge = assembleBacktestResult(baseInput(10));
    // Inflate a warnings array to blow past 2MB deterministically, without a huge fixture.
    huge.warnings = Array.from({ length: 200_000 }, () => "x".repeat(20));
    const serialized = serializeForResponse(huge);
    expect(serialized.ok).toBe(false);
    if (!serialized.ok) expect(serialized.reason).toBe("RESPONSE_TOO_LARGE");
  });
});
