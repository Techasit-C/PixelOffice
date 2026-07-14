// Bollinger Bands. A MEAN-REVERSION contribution layered on an otherwise
// trend-following setup (see enrichment.ts) — this module never determines
// direction, only how favorably/unfavorably the current price is positioned.
// Deterministic, no I/O.
import { sma } from "./indicators";
import { BOLLINGER_PERIOD, BOLLINGER_STDDEV_MULT } from "./config";

export interface BollingerResult {
  middle: number | null;
  upper: number | null;
  lower: number | null;
  /** %B = (close - lower) / (upper - lower). Unclamped — can be <0 or >1. */
  percentB: number | null;
}

export function bollingerBands(
  closes: number[],
  period: number = BOLLINGER_PERIOD,
  stdDevMult: number = BOLLINGER_STDDEV_MULT,
): BollingerResult {
  if (closes.length < period) {
    return { middle: null, upper: null, lower: null, percentB: null };
  }

  const window = closes.slice(closes.length - period);
  const middle = sma(closes, period)!;
  const variance = window.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stdev = Math.sqrt(variance);

  if (stdev === 0) {
    // Degenerate flat closes — bands collapse to the SMA. %B is undefined
    // (0/0), never fabricated as 0 or clamped silently.
    return { middle, upper: middle, lower: middle, percentB: null };
  }

  const upper = middle + stdDevMult * stdev;
  const lower = middle - stdDevMult * stdev;
  const lastClose = closes[closes.length - 1];
  const percentB = (lastClose - lower) / (upper - lower);

  return { middle, upper, lower, percentB };
}
