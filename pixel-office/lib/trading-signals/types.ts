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
}
