import { describe, it, expect } from "vitest";
import type {
  RejectionReason,
  ExitReason,
  TradeLedgerEntry,
  EquityPoint,
  DataQualityReport,
  UnexecutedSignalRecord,
  ExecutionEvent,
  BacktestConfig,
  BacktestMetrics,
  BenchmarkResult,
  BacktestResult,
} from "@/lib/backtest/types";

describe("lib/backtest/types.ts", () => {
  it("RejectionReason covers every named reason from the spec", () => {
    const reasons: RejectionReason[] = [
      "GAP_BEFORE_ENTRY",
      "GAP_THROUGH_STOP",
      "GAP_THROUGH_TARGET",
      "ENTRY_ZONE_MISSED",
      "ENTRY_ZONE_MISSED_AFTER_COSTS",
      "COST_ADJUSTED_ENTRY_INVALID",
      "NON_POSITIVE_NET_RISK",
      "NON_POSITIVE_NET_REWARD",
      "REALIZED_RR_BELOW_MINIMUM",
      "QUANTITY_TOO_SMALL",
      "INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE",
      "RISK_BUDGET_UNREPRESENTABLE",
      "NON_POSITIVE_ACTUAL_RISK",
    ];
    expect(reasons.length).toBe(13);
  });

  it("ExitReason covers STOP/TP1/END_OF_TEST only", () => {
    const reasons: ExitReason[] = ["STOP", "TP1", "END_OF_TEST"];
    expect(reasons.length).toBe(3);
  });

  it("a fully-populated TradeLedgerEntry, EquityPoint, DataQualityReport, and BacktestResult type-check", () => {
    const ledgerEntry: TradeLedgerEntry = {
      entryTime: 0, entryPrice: "0", quantity: "0", entryNotional: "0", entryFee: "0",
      entryCost: "0", exitTime: 0, exitPrice: "0", exitReason: "STOP", exitNotional: "0",
      exitFee: "0", exitProceeds: "0", realizedPnl: "0", intendedRiskBudget: "0",
      actualNetRisk: "0", actualRiskFraction: 0, cashCapped: false, netRiskReward: 0,
      warnings: [],
    };
    const equityPoint: EquityPoint = { time: 0, equity: "0" };
    const report: DataQualityReport = {
      malformedCount: 0, invalidOhlcCount: 0, exactDuplicateCount: 0,
      conflictingDuplicateCount: 0, reordered: false, reorderCount: 0, gapCount: 0,
      gaps: [], coverageShortfall: null,
    };
    const unexecuted: UnexecutedSignalRecord = { barCloseTime: 0, reason: "GAP_BEFORE_ENTRY" };
    const event: ExecutionEvent = { type: "SIGNAL_COMPUTED", time: 0, sequenceNumber: 0 };
    const config: BacktestConfig = {
      symbol: "BTC/USDT", requestedStart: 0, requestedEnd: 0,
      initialBalance: "10000", feeRate: "0.001", spreadBps: 5, slippageBps: 5,
    };
    const metrics: BacktestMetrics = {
      netProfit: "0", totalReturn: 0, winRate: 0, lossRate: 0, profitFactor: null,
      profitFactorReason: "undefined — no losing trades in this run", maxDrawdownPct: 0,
      sharpe: null, tradeCount: 0, averageWin: "0", averageLoss: "0", expectancy: "0",
    };
    const benchmark: BenchmarkResult = {
      entryTime: 0, entryPrice: "0", quantity: "0", exitTime: 0, exitPrice: "0",
      finalCash: "10000", metrics, equityCurve: [equityPoint],
    };
    const result: BacktestResult = {
      engineVersion: "phase3-v1", symbol: "BTC/USDT", timeframe: "4h",
      dataSource: "MEXC public klines",
      requestedRange: { start: 0, end: 0 },
      fetchedWarmupRange: {
        primary: { start: 0, end: 0 }, oneHour: { start: 0, end: 0 }, oneDay: { start: 0, end: 0 },
      },
      actualEvaluationRange: { start: 0, end: 0 },
      candleCounts: { primary: 0, oneHour: 0, oneDay: 0 },
      config: { initialBalance: "10000", feeRate: "0.001", spreadBps: 5, slippageBps: 5, riskPerTradeFraction: "0.005" },
      dataQuality: report,
      tradeLedger: [ledgerEntry],
      unexecutedSignals: [unexecuted],
      equityCurve: [equityPoint],
      equityCurveChart: [equityPoint],
      metrics,
      benchmark,
      warnings: [],
    };
    expect([ledgerEntry, equityPoint, report, unexecuted, event, config, metrics, benchmark, result].length).toBe(9);
  });
});
