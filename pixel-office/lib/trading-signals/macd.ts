// MACD (Moving Average Convergence Divergence). Deterministic, no I/O.
// Warm-up: slowPeriod (26) bars to seed the slow EMA, + signalPeriod (9) more
// MACD-line values to seed the signal EMA => 34 bars minimum. Within the
// existing MIN_BARS=60 floor. Full precision throughout; rounding only at
// display time in reasoning strings, matching the existing convention.
import { emaSeries } from "./indicators";

export interface MacdResult {
  macdLine: number | null;
  signalLine: number | null;
  histogram: number | null;
}

export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  if (closes.length < slowPeriod + signalPeriod - 1) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const fast = emaSeries(closes, fastPeriod);
  const slow = emaSeries(closes, slowPeriod);
  const macdLineSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const f = fast[i];
    const s = slow[i];
    if (f !== null && s !== null) macdLineSeries.push(f - s);
  }

  if (macdLineSeries.length < signalPeriod) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const macdLine = macdLineSeries[macdLineSeries.length - 1];
  const signalSeries = emaSeries(macdLineSeries, signalPeriod);
  const signalLine = signalSeries[signalSeries.length - 1];
  if (signalLine === null) {
    return { macdLine, signalLine: null, histogram: null };
  }

  return { macdLine, signalLine, histogram: macdLine - signalLine };
}
