// Signal engine orchestration — READ-ONLY, ANALYSIS-ONLY.
//
// Pipeline per symbol: getCandles (public, keyless) -> insufficient? WAIT/insufficient
// -> computeIndicators -> detectSetup -> riskGate -> TradingSignal. The engine
// PRODUCES OPINIONS ONLY. It imports no exchange client and no order/execution path;
// there is nothing here that can place, cancel, size, or manage a live position.
import { getCandles, type CandleSeries } from "@/lib/market-data/candles";
import type { Timeframe, TradingSignal } from "./types";
import {
  CANDLE_LIMIT,
  DEFAULT_TIMEFRAME,
  MIN_BARS,
  SUPPORTED_SYMBOLS,
  SYMBOL_WHITELIST,
} from "./config";
import { computeIndicators, detectSetup } from "./setup";
import { riskGate } from "./risk-gate";

const WAIT_INVALIDATION =
  "No actionable setup. Re-evaluate on the next closed bar or when a valid R:R setup forms.";

function waitSignal(
  symbol: string,
  timeframe: Timeframe,
  source: "analysis" | "insufficient-data",
  reasoning: string[],
  confidence: number,
  generatedAt: string,
  suggestedEntry: { low: number; high: number } | null = null,
  observedRiskReward: number | null = null,
): TradingSignal {
  return {
    symbol,
    timeframe,
    direction: "WAIT",
    entryZone: null,
    stopLoss: null,
    takeProfit: [],
    riskRewardRatio: null,
    confidence,
    reasoning,
    invalidationCondition: suggestedEntry
      ? `${WAIT_INVALIDATION} Re-evaluate on a pullback toward the suggested entry zone.`
      : WAIT_INVALIDATION,
    generatedAt,
    source,
    suggestedEntry,
    observedRiskReward,
  };
}

/**
 * Pure analysis seam: turn a candle series into a signal. Deterministic given the
 * series and timestamp (the only ambient value, injectable for tests).
 */
export function buildSignalFromCandles(
  series: CandleSeries,
  generatedAt: string = new Date().toISOString(),
): TradingSignal {
  const { symbol, timeframe, candles } = series;

  // Honest degrade: provider miss OR too few bars to analyse -> WAIT/insufficient.
  if (series.source === "insufficient" || candles.length < MIN_BARS) {
    return waitSignal(
      symbol,
      timeframe,
      "insufficient-data",
      [
        series.source === "insufficient"
          ? "No live candles available (provider unreachable or returned nothing). Not fabricating data."
          : `Only ${candles.length} bars available; need ≥ ${MIN_BARS} to analyse.`,
      ],
      0,
      generatedAt,
    );
  }

  const indicators = computeIndicators(candles);
  const setup = detectSetup(indicators);
  const gate = riskGate(setup);

  if (!gate.approved || setup === null) {
    return waitSignal(
      symbol,
      timeframe,
      "analysis",
      [...(setup?.reasoning ?? []), ...gate.reasoning],
      setup?.confidence ?? 0,
      generatedAt,
      setup?.suggestedEntry ?? null,
      setup?.observedRiskReward ?? null,
    );
  }

  const lastClose = indicators.lastClose ?? setup.entryZone.high;
  const invalidation =
    setup.direction === "LONG"
      ? `Invalidated on a close below the stop-loss ${setup.stopLoss!.toFixed(2)}.`
      : `Invalidated on a close above the stop-loss ${setup.stopLoss!.toFixed(2)}.`;

  return {
    symbol,
    timeframe,
    direction: setup.direction,
    entryZone: setup.entryZone,
    stopLoss: setup.stopLoss,
    takeProfit: setup.takeProfit,
    riskRewardRatio: setup.riskRewardRatio,
    confidence: setup.confidence,
    reasoning: [
      `Reference price ${lastClose.toFixed(2)} at analysis time.`,
      ...setup.reasoning,
      ...gate.reasoning,
    ],
    invalidationCondition: invalidation,
    generatedAt,
    source: "analysis",
    // Actionable: no pullback suggestion. Carry the observed structural R:R diagnostic
    // (the structural level's R:R, if one was measured; else null).
    suggestedEntry: null,
    observedRiskReward: setup.observedRiskReward,
  };
}

/**
 * Generate signals for the requested (whitelisted) symbols in parallel. Unknown
 * symbols are not guessed — they degrade to WAIT/insufficient-data. Never throws.
 */
export async function generateSignals(
  symbols: string[] = SUPPORTED_SYMBOLS,
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
): Promise<TradingSignal[]> {
  const generatedAt = new Date().toISOString();

  return Promise.all(
    symbols.map(async (symbol): Promise<TradingSignal> => {
      const ticker = SYMBOL_WHITELIST[symbol];
      if (!ticker) {
        return waitSignal(
          symbol,
          timeframe,
          "insufficient-data",
          [`Symbol "${symbol}" is not in the analysis whitelist — not analysed.`],
          0,
          generatedAt,
        );
      }
      const series = await getCandles(ticker, timeframe, CANDLE_LIMIT);
      // Re-label the series to the human symbol ("BTC/USDT") for the output.
      return buildSignalFromCandles({ ...series, symbol }, generatedAt);
    }),
  );
}
