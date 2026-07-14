// Domain types for the deterministic Phase 3 backtesting core. No I/O, no wall clock.
// SAFETY: nothing here may reference order/withdraw/transfer/execute/leverage/broker
// capability — this module is scanned by the extended trading-signals safety test.
export type PrimaryTimeframe = "4h";

export type RejectionReason =
  | "GAP_BEFORE_ENTRY"
  | "GAP_THROUGH_STOP"
  | "GAP_THROUGH_TARGET"
  | "ENTRY_ZONE_MISSED"
  | "ENTRY_ZONE_MISSED_AFTER_COSTS"
  | "COST_ADJUSTED_ENTRY_INVALID"
  | "NON_POSITIVE_NET_RISK"
  | "NON_POSITIVE_NET_REWARD"
  | "REALIZED_RR_BELOW_MINIMUM"
  | "QUANTITY_TOO_SMALL"
  | "INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE"
  | "RISK_BUDGET_UNREPRESENTABLE"
  | "NON_POSITIVE_ACTUAL_RISK";

export type ExitReason = "STOP" | "TP1" | "END_OF_TEST";

export interface TradeLedgerEntry {
  entryTime: number;
  entryPrice: string;
  quantity: string;
  entryNotional: string;
  entryFee: string;
  entryCost: string;
  exitTime: number;
  exitPrice: string;
  exitReason: ExitReason;
  exitNotional: string;
  exitFee: string;
  exitProceeds: string;
  realizedPnl: string;
  intendedRiskBudget: string;
  actualNetRisk: string;
  actualRiskFraction: number;
  cashCapped: boolean;
  netRiskReward: number;
  warnings: string[];
}

export interface EquityPoint {
  time: number;
  equity: string;
}

export interface DataQualityReport {
  malformedCount: number;
  invalidOhlcCount: number;
  exactDuplicateCount: number;
  conflictingDuplicateCount: number;
  reordered: boolean;
  reorderCount: number;
  gapCount: number;
  gaps: { after: number; before: number; missingBars: number }[];
  coverageShortfall: {
    requestedStart: number;
    requestedEnd: number;
    actualStart: number | null;
    actualEnd: number | null;
  } | null;
}

export interface UnexecutedSignalRecord {
  barCloseTime: number;
  reason: RejectionReason;
}

export interface ExecutionEvent {
  type:
    | "SIGNAL_COMPUTED"
    | "ENTRY_PROCESSED"
    | "GAP_EXIT_PROCESSED"
    | "INTRABAR_EXIT_PROCESSED"
    | "EQUITY_MARKED";
  time: number;
  sequenceNumber: number;
}

export interface BacktestConfig {
  symbol: string;
  requestedStart: number;
  requestedEnd: number;
  initialBalance: string;
  feeRate: string;
  spreadBps: number;
  slippageBps: number;
}

export interface BacktestMetrics {
  netProfit: string;
  totalReturn: number;
  winRate: number;
  lossRate: number;
  profitFactor: number | null;
  profitFactorReason: string | null;
  maxDrawdownPct: number;
  sharpe: number | null;
  tradeCount: number;
  averageWin: string;
  averageLoss: string;
  expectancy: string;
}

export interface BenchmarkResult {
  entryTime: number;
  entryPrice: string;
  quantity: string;
  exitTime: number;
  exitPrice: string;
  finalCash: string;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
}

export interface BacktestResult {
  engineVersion: string;
  symbol: string;
  timeframe: PrimaryTimeframe;
  dataSource: "MEXC public klines";
  requestedRange: { start: number; end: number };
  fetchedWarmupRange: {
    primary: { start: number; end: number };
    oneHour: { start: number; end: number };
    oneDay: { start: number; end: number };
  };
  actualEvaluationRange: { start: number; end: number };
  candleCounts: { primary: number; oneHour: number; oneDay: number };
  config: {
    initialBalance: string;
    feeRate: string;
    spreadBps: number;
    slippageBps: number;
    riskPerTradeFraction: string;
  };
  dataQuality: DataQualityReport;
  tradeLedger: TradeLedgerEntry[];
  unexecutedSignals: UnexecutedSignalRecord[];
  equityCurve: EquityPoint[];
  equityCurveChart: EquityPoint[];
  metrics: BacktestMetrics;
  benchmark: BenchmarkResult;
  warnings: string[];
}
