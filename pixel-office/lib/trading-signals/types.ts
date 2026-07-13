// Public shapes for the READ-ONLY, ANALYSIS-ONLY trading signal engine.
//
// SAFETY: nothing here (or anywhere under lib/trading-signals/) may reference an
// order/withdraw/transfer/execute capability. A signal is an OPINION about levels,
// never an instruction the system can act on. Live execution stays disabled and no
// exchange (signed-key) client is imported anywhere in this module.
export type Timeframe = "1h" | "4h" | "1d";
export type SignalDirection = "LONG" | "SHORT" | "WAIT";
export type SignalSource = "analysis" | "mock" | "insufficient-data";

export interface PriceLevel {
  price: number;
  label: string;
}

export interface TradingSignal {
  symbol: string;
  timeframe: Timeframe;
  direction: SignalDirection;
  entryZone: { low: number; high: number } | null;
  stopLoss: number | null;
  takeProfit: PriceLevel[];
  riskRewardRatio: number | null;
  confidence: number; // 0..100
  reasoning: string[];
  invalidationCondition: string;
  generatedAt: string;
  source: SignalSource;
  /** Optional. When WAIT is returned because R:R at the current entry is below MIN_RR,
   *  a better pullback/retest entry zone that would improve R:R. Analysis suggestion
   *  only — never an order or a live entry. Absent/null otherwise. */
  suggestedEntry?: { low: number; high: number } | null;
  /** Optional diagnostic: the R:R actually observed at the current entry, which MAY be
   *  below MIN_RR. Distinct from riskRewardRatio (which stays null unless actionable). */
  observedRiskReward?: number | null;
}
