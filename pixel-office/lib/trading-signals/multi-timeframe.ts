// Multi-timeframe confirmation: does the 1h/1d directional bias agree with the
// primary (4h) signal's direction? Directional-bias-only — no stop/target/R:R
// math on confirmation timeframes. Deterministic given already-fetched candles;
// this module performs no I/O itself (see engine.ts for the actual fetching,
// bounded via mapWithConcurrency below).
import type { Candle } from "@/lib/market-data/candles";
import type { SignalDirection, Timeframe } from "./types";
import { sma } from "./indicators";
import { toClosedSeries } from "./candle-closed";
import { CONFIRMATION_MIN_BARS } from "./config";

export type ConfirmationState = "ALIGNED" | "NEUTRAL" | "UNAVAILABLE" | "OPPOSITE";

// Independent of detectSetup's own 0.2% trend-alignment gap (setup.ts) — this
// is a separate, confirmation-only flatness threshold.
const TREND_FLAT_EPSILON = 0.0005;

function classifyBias(fastSma: number, slowSma: number): "LONG" | "SHORT" | "FLAT" {
  const gap = Math.abs(fastSma - slowSma) / slowSma;
  if (gap <= TREND_FLAT_EPSILON) return "FLAT";
  return fastSma > slowSma ? "LONG" : "SHORT";
}

export function deriveConfirmationState(
  candles: Candle[],
  timeframe: Timeframe,
  now: number,
  primaryDirection: Exclude<SignalDirection, "WAIT">,
): ConfirmationState {
  const { closedCandles, stale } = toClosedSeries(candles, timeframe, now);
  if (stale || closedCandles.length < CONFIRMATION_MIN_BARS) return "UNAVAILABLE";

  const closes = closedCandles.map((c) => c.close);
  const fast = sma(closes, 20);
  const slow = sma(closes, 50);
  if (fast === null || slow === null) return "UNAVAILABLE";

  const bias = classifyBias(fast, slow);
  if (bias === "FLAT") return "NEUTRAL";
  return bias === primaryDirection ? "ALIGNED" : "OPPOSITE";
}

/** The exhaustive 16-row table (design §8): any OPPOSITE -> -15 once; else
 *  count ALIGNED: 2 -> +15, 1 -> +5, 0 -> 0. */
export function scoreConfirmation(oneHour: ConfirmationState, oneDay: ConfirmationState): number {
  if (oneHour === "OPPOSITE" || oneDay === "OPPOSITE") return -15;
  const alignedCount = [oneHour, oneDay].filter((s) => s === "ALIGNED").length;
  if (alignedCount === 2) return 15;
  if (alignedCount === 1) return 5;
  return 0;
}

export interface ConfirmationCandles {
  oneHourCandles: Candle[];
  oneDayCandles: Candle[];
}

export interface MultiTimeframeResult {
  oneHour: ConfirmationState;
  oneDay: ConfirmationState;
  adjustment: number;
  reasoning: string[];
}

export function confirmMultiTimeframe(
  input: ConfirmationCandles,
  primaryDirection: Exclude<SignalDirection, "WAIT">,
  now: number,
): MultiTimeframeResult {
  const oneHour = deriveConfirmationState(input.oneHourCandles, "1h", now, primaryDirection);
  const oneDay = deriveConfirmationState(input.oneDayCandles, "1d", now, primaryDirection);
  const adjustment = scoreConfirmation(oneHour, oneDay);
  return {
    oneHour,
    oneDay,
    adjustment,
    reasoning: [
      `1h confirmation: ${oneHour.toLowerCase()}.`,
      `1d confirmation: ${oneDay.toLowerCase()}.`,
    ],
  };
}

/** Small internal concurrency limiter — bounds simultaneous async work. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
