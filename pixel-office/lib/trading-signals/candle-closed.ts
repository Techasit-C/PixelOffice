// Closed-candle and staleness detection — the two distinct concepts Phase 2
// requires: CLOSED (has this candle's period actually ended yet, so it's safe
// to run indicator math on) vs FRESH (has a new closed candle arrived recently
// enough to trust the feed). Both take an injected `now` (always the caller's
// server-authoritative analysisNow — see engine.ts) — never a client timestamp.
import type { Candle } from "@/lib/market-data/candles";
import type { Timeframe } from "./types";
import { STALE_GRACE_MS } from "./config";

export const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export function isClosed(candle: Candle, timeframe: Timeframe, now: number): boolean {
  return now >= candle.openTime + TIMEFRAME_DURATION_MS[timeframe];
}

/** Strips ANY number of trailing candles whose period has not yet ended. */
export function dropUnclosedTrailing(candles: Candle[], timeframe: Timeframe, now: number): Candle[] {
  let end = candles.length;
  while (end > 0 && !isClosed(candles[end - 1], timeframe, now)) end--;
  return candles.slice(0, end);
}

export interface ClosedSeriesResult {
  closedCandles: Candle[];
  stale: boolean;
  reason?: string;
}

/**
 * Staleness is measured from when the NEXT candle's close was expected
 * (last.openTime + 2×duration), not from the last candle's own open time —
 * using the last candle's own open time would falsely mark a just-closed
 * candle stale within minutes of the next candle starting to form.
 */
export function toClosedSeries(candles: Candle[], timeframe: Timeframe, now: number): ClosedSeriesResult {
  const closed = dropUnclosedTrailing(candles, timeframe, now);
  const last = closed[closed.length - 1];
  if (!last) {
    return { closedCandles: [], stale: true, reason: "no closed candles available" };
  }

  const duration = TIMEFRAME_DURATION_MS[timeframe];
  const nextExpectedCloseTime = last.openTime + 2 * duration;
  const stale = now - last.openTime > 2 * duration + STALE_GRACE_MS;

  return {
    closedCandles: closed,
    stale,
    reason: stale
      ? `next ${timeframe} candle close was expected by ${new Date(nextExpectedCloseTime).toISOString()}, past the ${Math.round(STALE_GRACE_MS / 60000)}min grace ceiling`
      : undefined,
  };
}
