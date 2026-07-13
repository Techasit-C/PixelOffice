// Keyless PUBLIC OHLCV candle provider for the analysis-only signal engine.
//
// SAFETY / HONESTY CONTRACT:
//   • PUBLIC market data only — plain `fetch`, NO API keys, NO request signing.
//   • This module NEVER imports an exchange (signed-key) client and exposes no
//     order/withdraw/transfer/execute capability. It reads candles and nothing else.
//   • It NEVER fabricates candles. On ANY failure (network down, non-200, bad shape,
//     timeout, too few bars) it returns `{ candles: [], source: "insufficient" }`.
//     It never throws and never emits synthetic OHLCV.
//
// The host is swappable behind `getCandles` (default MEXC public klines; Binance
// klines share the same array shape, so KLINES_HOST can point at either).
import type { Timeframe } from "@/lib/trading-signals/types";

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleSource = "live" | "cache" | "insufficient";

export interface CandleSeries {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  source: CandleSource;
  fetchedAt: number;
}

// Public keyless klines host. MEXC and Binance both accept the same query shape
// (symbol/interval/limit) and return the same positional array, so this is the only
// line to change to swap providers. NO key, NO signing — public endpoint only.
const KLINES_HOST = "https://api.mexc.com";

// MEXC/Binance interval codes for our supported timeframes.
const INTERVAL_MAP: Record<Timeframe, string> = {
  "1h": "60m",
  "4h": "4h",
  "1d": "1d",
};

const CACHE_TTL_MS = 60_000; // short shield; candles for a closed bar are stable
const FETCH_TIMEOUT_MS = 8_000;
/** Absolute floor: fewer bars than this is never enough to compute an indicator. */
const MIN_USABLE_BARS = 2;

interface CacheEntry {
  series: CandleSeries;
  at: number;
}

// Module-scoped TTL cache — mirrors the spot cache idiom in market-data/service.ts.
// Survives across requests in a warm Node runtime; per-instance in serverless.
const candleCache = new Map<string, CacheEntry>();

function cacheKey(ticker: string, timeframe: Timeframe, limit: number): string {
  return `${ticker}:${timeframe}:${limit}`;
}

function insufficient(
  symbol: string,
  timeframe: Timeframe,
  fetchedAt: number,
): CandleSeries {
  return { symbol, timeframe, candles: [], source: "insufficient", fetchedAt };
}

// Coerce one raw kline row (positional array) into a Candle, or null if any field
// is missing / non-finite. Rejecting a bad row keeps us honest — no zero-fill.
function parseRow(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const openTime = Number(row[0]);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);
  if (
    ![openTime, open, high, low, close, volume].every((n) => Number.isFinite(n))
  ) {
    return null;
  }
  return { openTime, open, high, low, close, volume };
}

/**
 * Fetch up to `limit` public candles for `symbol` (already the exchange ticker,
 * e.g. "BTCUSDT") at `timeframe`. Cache -> live -> insufficient. Never throws.
 */
export async function getCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<CandleSeries> {
  const now = Date.now();
  const key = cacheKey(symbol, timeframe, limit);

  const cached = candleCache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    // Serve the cached series; mark provenance as "cache" unless it was itself a
    // miss (insufficient), in which case keep the honest "insufficient".
    if (cached.series.source === "insufficient") return cached.series;
    return { ...cached.series, source: "cache", fetchedAt: cached.at };
  }

  const interval = INTERVAL_MAP[timeframe];
  const url = `${KLINES_HOST}/api/v3/klines?symbol=${encodeURIComponent(
    symbol,
  )}&interval=${interval}&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      // Read-only public data; do not let Next cache stale market data.
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      // Non-200 (rate-limited, geo-blocked, upstream error) -> honest miss.
      return insufficient(symbol, timeframe, now);
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return insufficient(symbol, timeframe, now);

    const candles: Candle[] = [];
    for (const row of body) {
      const c = parseRow(row);
      if (c) candles.push(c);
    }
    if (candles.length < MIN_USABLE_BARS) {
      return insufficient(symbol, timeframe, now);
    }

    // Ensure chronological order (oldest -> newest) regardless of host ordering.
    candles.sort((a, b) => a.openTime - b.openTime);

    const series: CandleSeries = {
      symbol,
      timeframe,
      candles,
      source: "live",
      fetchedAt: now,
    };
    candleCache.set(key, { series, at: now });
    return series;
  } catch {
    // Network down / abort / timeout / bad JSON — never throw, never fabricate.
    return insufficient(symbol, timeframe, now);
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam: clear the in-memory candle cache between cases. */
export function __resetCandleCache(): void {
  candleCache.clear();
}
