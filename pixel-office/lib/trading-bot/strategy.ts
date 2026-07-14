import { Prisma } from "@prisma/client";
import { getCandles } from "@/lib/market-data/candles";
import { buildSignalFromCandles } from "@/lib/trading-signals/engine";
import {
  CANDLE_LIMIT,
  DEFAULT_TIMEFRAME,
  SUPPORTED_SYMBOLS,
  SYMBOL_WHITELIST,
} from "@/lib/trading-signals/config";
import { checkCandleFreshness } from "./freshness";
import { SIGNAL_FRESHNESS_WINDOW_MS } from "./config";
import { defaultReason } from "./errors";
import type { RejectCode, TradeIntent } from "./types";

export type StrategyResult =
  | { ok: true; intent: TradeIntent }
  | { ok: false; code: RejectCode; reason: string };

export interface Strategy {
  generateIntent(
    userId: string,
    signalId: string,
    observedGeneratedAt: string,
    requestedQuantity: Prisma.Decimal,
  ): Promise<StrategyResult>;
}

function reject(code: RejectCode, reason?: string): StrategyResult {
  return { ok: false, code, reason: reason ?? defaultReason(code) };
}

/** signalId format: "<symbol>:<timeframe>", validated against the whitelist. */
export function parseSignalId(signalId: string): { symbol: string; timeframe: "4h" } | null {
  const [symbol, timeframe] = signalId.split(":");
  if (!symbol || !timeframe) return null;
  if (!SUPPORTED_SYMBOLS.includes(symbol)) return null;
  if (timeframe !== DEFAULT_TIMEFRAME) return null;
  return { symbol, timeframe: DEFAULT_TIMEFRAME as "4h" };
}

export class SignalEngineStrategy implements Strategy {
  async generateIntent(
    userId: string,
    signalId: string,
    observedGeneratedAt: string,
    requestedQuantity: Prisma.Decimal,
  ): Promise<StrategyResult> {
    const parsed = parseSignalId(signalId);
    if (!parsed) return reject("UNRECOGNIZED_SIGNAL");
    const { symbol, timeframe } = parsed;
    const ticker = SYMBOL_WHITELIST[symbol];

    // Candle-data freshness — independent of signal-instance age, checked first
    // so we never spend effort building a signal from data already known stale.
    const series = await getCandles(ticker, timeframe, CANDLE_LIMIT);
    const freshness = checkCandleFreshness(series.candles, timeframe, Date.now());
    if (!freshness.ok) return reject(freshness.code, freshness.reason);

    const signal = buildSignalFromCandles({ ...series, symbol }, new Date().toISOString());

    if (signal.direction === "WAIT" || signal.source === "insufficient-data") {
      return reject("NON_ACTIONABLE_SIGNAL");
    }
    if (signal.direction === "SHORT") {
      return reject("UNSUPPORTED_SHORT");
    }
    if (signal.stopLoss === null || signal.entryZone === null) {
      return reject("NON_ACTIONABLE_SIGNAL", "Signal is missing required levels.");
    }

    // Signal-INSTANCE age — independent of candle freshness above. Bounds how
    // long ago the specific signal the user looked at was generated.
    const observedAgeMs = Date.now() - Date.parse(observedGeneratedAt);
    if (!Number.isFinite(observedAgeMs) || observedAgeMs > SIGNAL_FRESHNESS_WINDOW_MS) {
      return reject("STALE_SIGNAL");
    }

    if (
      !requestedQuantity.isFinite() ||
      requestedQuantity.isNegative() ||
      requestedQuantity.isZero()
    ) {
      return reject("INVALID_QUANTITY");
    }

    const intent: TradeIntent = {
      userId,
      symbol,
      timeframe,
      side: "BUY",
      requestedQuantity,
      sourceSignal: {
        direction: "LONG",
        entryZone: signal.entryZone,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskRewardRatio: signal.riskRewardRatio,
        confidence: signal.confidence,
        generatedAt: signal.generatedAt,
      },
      createdAt: new Date().toISOString(),
    };
    return { ok: true, intent };
  }
}

export const signalEngineStrategy = new SignalEngineStrategy();
