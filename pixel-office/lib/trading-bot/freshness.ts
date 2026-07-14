import type { Candle } from "@/lib/market-data/candles";
import type { Timeframe } from "@/lib/trading-signals/types";

export const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

/** Small documented grace period on top of one full timeframe interval. */
export const CANDLE_STALENESS_GRACE_MS = 5 * 60_000;

export type FreshnessResult =
  | { ok: true }
  | { ok: false; code: "STALE_CANDLE_DATA"; reason: string };

/**
 * Stale when `candles` is empty, or when the most recent candle's openTime is
 * older than one full timeframe interval plus the grace period. Independent of
 * signal-instance age (SIGNAL_FRESHNESS_WINDOW_MS) — a valid slow-timeframe
 * signal is never rejected here merely for being "more than five minutes old".
 */
export function checkCandleFreshness(
  candles: Candle[],
  timeframe: Timeframe,
  now: number,
): FreshnessResult {
  const last = candles[candles.length - 1];
  if (!last) {
    return { ok: false, code: "STALE_CANDLE_DATA", reason: "no candle data available" };
  }
  const maxAgeMs = TIMEFRAME_DURATION_MS[timeframe] + CANDLE_STALENESS_GRACE_MS;
  const ageMs = now - last.openTime;
  if (ageMs > maxAgeMs) {
    const ageMin = Math.round(ageMs / 60_000);
    const maxMin = Math.round(maxAgeMs / 60_000);
    return {
      ok: false,
      code: "STALE_CANDLE_DATA",
      reason: `latest ${timeframe} candle is ${ageMin} min old, exceeds the ${maxMin} min freshness ceiling`,
    };
  }
  return { ok: true };
}
