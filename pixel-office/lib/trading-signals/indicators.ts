// Pure technical-indicator math. Deterministic, no I/O, no randomness, no Date.now.
// Every function is a total function of its numeric inputs, so the whole analysis
// path is unit-testable from hand-authored fixtures.
import type { Candle } from "@/lib/market-data/candles";

/** Simple moving average of the LAST `period` values. null if not enough data. */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/**
 * Exponential moving average over the whole series, returning the final value.
 * Seeds with the SMA of the first `period` values (standard convention).
 */
export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);
  // Seed = SMA of the first `period` samples.
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/**
 * Wilder's RSI over the final `period` window. Returns 0..100, or null when there
 * are fewer than `period + 1` closes. 100 when there are no losses in-window.
 */
export function rsi(closes: number[], period: number): number | null {
  if (period <= 0 || closes.length < period + 1) return null;
  // Seed average gain/loss over the first `period` deltas.
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  // Wilder smoothing across the remainder.
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const up = delta > 0 ? delta : 0;
    const down = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Average True Range (Wilder) over the final `period` window. Needs `period + 1`
 * candles (true range references the prior close). null otherwise.
 */
export function atr(candles: Candle[], period: number): number | null {
  if (period <= 0 || candles.length < period + 1) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
    trueRanges.push(tr);
  }
  // Seed with the SMA of the first `period` TRs, then Wilder-smooth the rest.
  let prev = 0;
  for (let i = 0; i < period; i++) prev += trueRanges[i];
  prev /= period;
  for (let i = period; i < trueRanges.length; i++) {
    prev = (prev * (period - 1) + trueRanges[i]) / period;
  }
  return prev;
}

/** Average volume over the LAST `period` bars. null if not enough data. */
export function volumeAverage(candles: Candle[], period: number): number | null {
  if (period <= 0 || candles.length < period) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    sum += candles[i].volume;
  }
  return sum / period;
}

/**
 * Most-recent swing high: a bar whose high is >= the highs of `lookback` bars on
 * each side. Scans newest->oldest and returns the first such pivot's high, else null.
 */
export function swingHigh(candles: Candle[], lookback: number): number | null {
  if (lookback <= 0) return null;
  for (let i = candles.length - 1 - lookback; i >= lookback; i--) {
    const pivot = candles[i].high;
    let isPivot = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high > pivot || candles[i + j].high > pivot) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) return pivot;
  }
  return null;
}

/**
 * Most-recent swing low: a bar whose low is <= the lows of `lookback` bars on each
 * side. Scans newest->oldest and returns the first such pivot's low, else null.
 */
export function swingLow(candles: Candle[], lookback: number): number | null {
  if (lookback <= 0) return null;
  for (let i = candles.length - 1 - lookback; i >= lookback; i--) {
    const pivot = candles[i].low;
    let isPivot = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].low < pivot || candles[i + j].low < pivot) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) return pivot;
  }
  return null;
}

/** Convenience: extract the close series from candles. */
export function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}
