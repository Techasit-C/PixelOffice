// Signal engine orchestration — READ-ONLY, ANALYSIS-ONLY.
//
// Pipeline per symbol: getCandles (public, keyless) -> drop unclosed/stale
// candles -> computeIndicators -> detectSetup -> Phase 2 enrichment (MACD/
// Bollinger/multi-timeframe; confidence + reasoning only, see enrichment.ts) ->
// riskGate -> TradingSignal. The engine PRODUCES OPINIONS ONLY. It imports no
// exchange client and no order/execution path; there is nothing here that can
// place, cancel, size, or manage a live position.
import { getCandles, type CandleSeries } from "@/lib/market-data/candles";
import type { Timeframe, TradingSignal } from "./types";
import {
  CANDLE_LIMIT,
  DEFAULT_TIMEFRAME,
  MAX_CONCURRENT_CANDLE_FETCHES,
  MIN_BARS,
  SUPPORTED_SYMBOLS,
  SYMBOL_WHITELIST,
} from "./config";
import { closes } from "./indicators";
import { computeIndicators, detectSetup } from "./setup";
import { riskGate } from "./risk-gate";
import { toClosedSeries } from "./candle-closed";
import { macd } from "./macd";
import { bollingerBands } from "./bollinger";
import { applyPhase2Enrichment } from "./enrichment";
import {
  confirmMultiTimeframe,
  mapWithConcurrency,
  type ConfirmationCandles,
} from "./multi-timeframe";
import { buildPlainLanguageSummary } from "./explanation";

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
 * Pure analysis seam: turn a candle series into a signal. `generatedAt` is the
 * SOLE clock input and is always server-computed at every real call site
 * (generateSignals, SignalEngineStrategy) — no client-supplied timestamp ever
 * reaches this parameter. It is parsed once, internally, into `analysisNow`
 * (epoch ms), which drives every closed-candle/staleness decision below.
 */
export function buildSignalFromCandles(
  series: CandleSeries,
  generatedAt: string = new Date().toISOString(),
  confirmation?: ConfirmationCandles,
): TradingSignal {
  const { symbol, timeframe, candles } = series;
  const analysisNow = Date.parse(generatedAt);

  if (series.source === "insufficient") {
    return waitSignal(
      symbol,
      timeframe,
      "insufficient-data",
      ["No live candles available (provider unreachable or returned nothing). Not fabricating data."],
      0,
      generatedAt,
    );
  }

  const { closedCandles, stale, reason: staleReason } = toClosedSeries(candles, timeframe, analysisNow);
  if (stale || closedCandles.length < MIN_BARS) {
    return waitSignal(
      symbol,
      timeframe,
      "insufficient-data",
      [
        stale
          ? `Primary ${timeframe} data is stale: ${staleReason}`
          : `Only ${closedCandles.length} closed bars available; need ≥ ${MIN_BARS} to analyse.`,
      ],
      0,
      generatedAt,
    );
  }

  const indicators = computeIndicators(closedCandles);
  const rawSetup = detectSetup(indicators);

  const closePrices = closes(closedCandles);
  const macdResult = macd(closePrices);
  const bbResult = bollingerBands(closePrices);
  const confirmationResult = rawSetup
    ? confirmMultiTimeframe(
        confirmation ?? { oneHourCandles: [], oneDayCandles: [] },
        rawSetup.direction,
        analysisNow,
      )
    : null;

  const setup = applyPhase2Enrichment(rawSetup, {
    macd: macdResult,
    bollinger: bbResult,
    confirmation: confirmationResult,
  });
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
    suggestedEntry: null,
    observedRiskReward: setup.observedRiskReward,
    macd: macdResult,
    bollinger: bbResult,
    timeframeConfirmation: confirmationResult
      ? {
          oneHour: confirmationResult.oneHour,
          oneDay: confirmationResult.oneDay,
          adjustment: confirmationResult.adjustment,
        }
      : null,
    plainLanguageSummary: buildPlainLanguageSummary(
      setup.direction,
      setup.entryZone,
      setup.stopLoss,
      macdResult,
      bbResult,
      confirmationResult,
    ),
  };
}

interface FetchTask {
  symbol: string;
  ticker: string;
  timeframe: Timeframe;
}

/**
 * Generate signals for the requested (whitelisted) symbols in parallel. Unknown
 * symbols are not guessed — they degrade to WAIT/insufficient-data. Never throws.
 * Fetches the primary timeframe plus 1h/1d confirmation for every symbol,
 * bounded to MAX_CONCURRENT_CANDLE_FETCHES concurrent requests per call.
 */
export async function generateSignals(
  symbols: string[] = SUPPORTED_SYMBOLS,
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
): Promise<TradingSignal[]> {
  const generatedAt = new Date().toISOString();

  const tasks: FetchTask[] = [];
  for (const symbol of symbols) {
    const ticker = SYMBOL_WHITELIST[symbol];
    if (!ticker) continue;
    tasks.push({ symbol, ticker, timeframe });
    tasks.push({ symbol, ticker, timeframe: "1h" });
    tasks.push({ symbol, ticker, timeframe: "1d" });
  }

  const fetched = await mapWithConcurrency(tasks, MAX_CONCURRENT_CANDLE_FETCHES, async (task) => ({
    ...task,
    series: await getCandles(task.ticker, task.timeframe, CANDLE_LIMIT),
  }));

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
      const primary = fetched.find((f) => f.symbol === symbol && f.timeframe === timeframe)!.series;
      const oneHour = fetched.find((f) => f.symbol === symbol && f.timeframe === "1h")!.series;
      const oneDay = fetched.find((f) => f.symbol === symbol && f.timeframe === "1d")!.series;

      return buildSignalFromCandles({ ...primary, symbol }, generatedAt, {
        oneHourCandles: oneHour.candles,
        oneDayCandles: oneDay.candles,
      });
    }),
  );
}
