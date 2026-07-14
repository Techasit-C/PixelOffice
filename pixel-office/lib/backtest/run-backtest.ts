// Orchestrator: wires the REAL, unmodified buildSignalFromCandles as the simulation
// loop's SignalProvider, trims the primary series to the tradable range, and
// assembles simulate + benchmark + metrics + data-quality into one bundle. Zero I/O —
// every candle array is a parameter. This is the seam the future-independence tests
// call directly.
import { Prisma } from "@prisma/client";
import { buildSignalFromCandles } from "@/lib/trading-signals/engine";
import type { Candle } from "@/lib/market-data/candles";
import { runSimulation, type SignalProvider, type SimulateResult } from "./simulate";
import { runBenchmark } from "./benchmark";
import { computeMetrics } from "./metrics";
import { validateCandles } from "./validate-candles";
import { TIMEFRAME_DURATION_MS_4H, isTradableBar, type EvaluationWindow } from "./candle-window";
import type { BacktestMetrics, BenchmarkResult, DataQualityReport } from "./types";

export interface RunBacktestConfig {
  spreadBps: number;
  slippageBps: number;
  feeRate: Prisma.Decimal;
  initialBalance: Prisma.Decimal;
  finalize: boolean;
}

export interface RunBacktestResult {
  simulate: SimulateResult;
  benchmark: BenchmarkResult;
  metrics: BacktestMetrics;
  dataQuality: Omit<DataQualityReport, "malformedCount" | "coverageShortfall">;
}

function makeSignalProvider(oneHourCandles: Candle[], oneDayCandles: Candle[]): SignalProvider {
  return (closedPrimaryCandles, analysisNow) => {
    const series = {
      symbol: "BACKTEST",
      timeframe: "4h" as const,
      candles: closedPrimaryCandles,
      source: "live" as const,
      fetchedAt: analysisNow,
    };
    const signal = buildSignalFromCandles(series, new Date(analysisNow).toISOString(), {
      oneHourCandles,
      oneDayCandles,
    });
    if (signal.direction !== "LONG" || !signal.entryZone || signal.stopLoss === null || signal.takeProfit.length === 0) {
      return { direction: "WAIT", entryZone: null, stopLoss: null, takeProfit1: null };
    }
    return {
      direction: "LONG",
      entryZone: signal.entryZone,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfit[0].price,
    };
  };
}

export function runBacktest(
  primaryCandles: Candle[],
  oneHourCandles: Candle[],
  oneDayCandles: Candle[],
  window: EvaluationWindow,
  config: RunBacktestConfig,
): RunBacktestResult {
  const { candles: validatedPrimary, report: dataQuality } = validateCandles(primaryCandles, TIMEFRAME_DURATION_MS_4H);

  // Trim to bars opening strictly before effectiveEndBoundary — the tradable-bar open
  // criterion — so `primaryCandles[primaryCandles.length-1]` inside runSimulation is
  // guaranteed to be finalTradableBar.
  const trimmedPrimary = validatedPrimary.filter((c) => c.openTime < window.effectiveEndBoundary);

  const signalProvider = makeSignalProvider(oneHourCandles, oneDayCandles);
  const simulate = runSimulation(trimmedPrimary, window, TIMEFRAME_DURATION_MS_4H, signalProvider, config);

  // Reuse isTradableBar directly (rather than re-deriving its two conditions here) so
  // the benchmark's bar set can never drift from the strategy loop's own definition.
  const tradableCandles = trimmedPrimary.filter((c) =>
    isTradableBar(c.openTime, c.openTime + TIMEFRAME_DURATION_MS_4H, window),
  );
  const benchmark = runBenchmark(
    tradableCandles, config.spreadBps, config.slippageBps, config.feeRate, config.initialBalance, TIMEFRAME_DURATION_MS_4H,
  );

  const metrics = computeMetrics(simulate.equityCurve, simulate.tradeLedger, config.initialBalance);

  return { simulate, benchmark, metrics, dataQuality };
}
