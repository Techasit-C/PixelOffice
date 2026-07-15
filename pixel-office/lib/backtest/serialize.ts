// Assembles the final BacktestResult wire shape and enforces the self-imposed 2MB
// UTF-8 response cap (spec §12) — not a platform claim. Metrics and the full trade
// ledger always use full-resolution data; only .equityCurveChart is downsampled, and
// only for display — no metric is ever computed from the downsampled series.
import type { BacktestResult, DataQualityReport, EquityPoint } from "./types";
import type { RunBacktestResult } from "./run-backtest";

const EQUITY_CHART_MAX_POINTS = 500;
const RESPONSE_SIZE_CAP_BYTES = 2_097_152;

function downsampleEquityCurve(curve: EquityPoint[], maxPoints: number): EquityPoint[] {
  if (curve.length <= maxPoints) return curve;
  const stride = (curve.length - 1) / (maxPoints - 1);
  const out: EquityPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(curve.length - 1, Math.round(i * stride));
    out.push(curve[idx]);
  }
  return out;
}

export interface AssembleInput {
  engineVersion: string;
  symbol: string;
  requestedRange: { start: number; end: number };
  fetchedWarmupRange: BacktestResult["fetchedWarmupRange"];
  actualEvaluationRange: { start: number; end: number };
  candleCounts: BacktestResult["candleCounts"];
  configEcho: BacktestResult["config"];
  dataQuality: DataQualityReport;
  runResult: RunBacktestResult;
  extraWarnings: string[];
}

export function assembleBacktestResult(input: AssembleInput): BacktestResult {
  return {
    engineVersion: input.engineVersion,
    symbol: input.symbol,
    timeframe: "4h",
    dataSource: "MEXC public klines",
    requestedRange: input.requestedRange,
    fetchedWarmupRange: input.fetchedWarmupRange,
    actualEvaluationRange: input.actualEvaluationRange,
    candleCounts: input.candleCounts,
    config: input.configEcho,
    dataQuality: input.dataQuality,
    tradeLedger: input.runResult.simulate.tradeLedger,
    unexecutedSignals: input.runResult.simulate.unexecutedSignals,
    equityCurve: input.runResult.simulate.equityCurve,
    equityCurveChart: downsampleEquityCurve(input.runResult.simulate.equityCurve, EQUITY_CHART_MAX_POINTS),
    metrics: input.runResult.metrics,
    benchmark: input.runResult.benchmark,
    warnings: input.extraWarnings,
  };
}

export type SerializeResult = { ok: true; body: string } | { ok: false; reason: "RESPONSE_TOO_LARGE" };

export function serializeForResponse(result: BacktestResult): SerializeResult {
  const body = JSON.stringify(result);
  const byteLength = Buffer.byteLength(body, "utf8");
  if (byteLength > RESPONSE_SIZE_CAP_BYTES) {
    return { ok: false, reason: "RESPONSE_TOO_LARGE" };
  }
  return { ok: true, body };
}
