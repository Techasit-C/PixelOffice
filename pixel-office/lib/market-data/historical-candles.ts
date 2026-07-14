// Paginated, bounded, read-only public MEXC klines fetch for backtesting. Isolated
// from lib/backtest/ — never imported by it. Empirically verified contract (design
// spec §5.1, session of 2026-07-15): startTime/endTime are honored; limit is capped
// server-side at 500 rows regardless of the requested value; this is NOT a documented
// guarantee — re-verify if production behavior ever looks inconsistent with this file.
import type { Timeframe } from "@/lib/trading-signals/types";
import { TIMEFRAME_DURATION_MS } from "@/lib/trading-signals/candle-closed";
import type { Candle } from "./candles";

const KLINES_HOST = "https://api.mexc.com";
const INTERVAL_MAP: Record<Timeframe, string> = { "1h": "60m", "4h": "4h", "1d": "1d" };
const PAGE_LIMIT = 500;
export const MAX_PAGES_PER_TIMEFRAME = 20;
const PAGE_TIMEOUT_MS = 6_000;

export interface PaginatedFetchResult {
  candles: Candle[];
  malformedCount: number;
  truncated: boolean;
  failed: boolean;
  failureReason?: "CANCELLED" | "PAGE_FETCH_FAILED" | "PAGINATION_CURSOR_STUCK";
}

function parseRow(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const openTime = Number(row[0]);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);
  if (![openTime, open, high, low, close, volume].every((n) => Number.isFinite(n))) return null;
  return { openTime, open, high, low, close, volume };
}

async function fetchPage(
  symbol: string,
  timeframe: Timeframe,
  startTime: number,
  endTime: number,
  signal: AbortSignal | undefined,
): Promise<{ candles: Candle[]; malformedCount: number } | null> {
  const interval = INTERVAL_MAP[timeframe];
  const url = `${KLINES_HOST}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${PAGE_LIMIT}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return null;
    const candles: Candle[] = [];
    let malformedCount = 0;
    for (const row of body) {
      const c = parseRow(row);
      if (c) candles.push(c);
      else malformedCount++;
    }
    candles.sort((a, b) => a.openTime - b.openTime);
    return { candles, malformedCount };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

async function fetchPageWithRetry(
  symbol: string,
  timeframe: Timeframe,
  startTime: number,
  endTime: number,
  signal: AbortSignal | undefined,
): Promise<{ candles: Candle[]; malformedCount: number } | null> {
  const first = await fetchPage(symbol, timeframe, startTime, endTime, signal);
  if (first !== null) return first;
  if (signal?.aborted) return null;
  return fetchPage(symbol, timeframe, startTime, endTime, signal); // exactly one retry
}

export async function fetchHistoricalCandles(
  symbol: string,
  timeframe: Timeframe,
  fetchStartTime: number,
  fetchEndTime: number,
  signal?: AbortSignal,
): Promise<PaginatedFetchResult> {
  if (signal?.aborted) {
    return { candles: [], malformedCount: 0, truncated: false, failed: true, failureReason: "CANCELLED" };
  }

  const duration = TIMEFRAME_DURATION_MS[timeframe];
  let cursor = fetchStartTime;
  let allCandles: Candle[] = [];
  let malformedCount = 0;
  let pageCount = 0;
  let previousLastOpenTime: number | null = null;
  let previousSignature: string | null = null;

  while (cursor <= fetchEndTime) {
    if (signal?.aborted) {
      return { candles: allCandles, malformedCount, truncated: false, failed: true, failureReason: "CANCELLED" };
    }
    if (pageCount >= MAX_PAGES_PER_TIMEFRAME) {
      return { candles: allCandles, malformedCount, truncated: true, failed: false };
    }

    let page = await fetchPageWithRetry(symbol, timeframe, cursor, fetchEndTime, signal);
    if (page === null) {
      return { candles: allCandles, malformedCount, truncated: false, failed: true, failureReason: "PAGE_FETCH_FAILED" };
    }
    pageCount++;

    if (page.candles.length === 0) {
      // Structurally near the requested end -> genuine completion, not a suspicious gap.
      return { candles: allCandles, malformedCount: malformedCount + page.malformedCount, truncated: false, failed: false };
    }

    malformedCount += page.malformedCount;
    const firstOpenTime = page.candles[0].openTime;
    const lastOpenTime = page.candles[page.candles.length - 1].openTime;
    const signature = `${firstOpenTime}:${lastOpenTime}:${page.candles.length}`;

    if (previousLastOpenTime !== null && firstOpenTime <= previousLastOpenTime) {
      if (signature === previousSignature) {
        return { candles: allCandles, malformedCount, truncated: false, failed: true, failureReason: "PAGINATION_CURSOR_STUCK" };
      }
      page = { ...page, candles: page.candles.filter((c) => c.openTime > previousLastOpenTime!) };
      if (page.candles.length === 0) {
        return { candles: allCandles, malformedCount, truncated: false, failed: true, failureReason: "PAGINATION_CURSOR_STUCK" };
      }
    }

    allCandles = allCandles.concat(page.candles);
    previousLastOpenTime = page.candles[page.candles.length - 1].openTime;
    previousSignature = signature;

    if (page.candles.length < PAGE_LIMIT) {
      return { candles: allCandles, malformedCount, truncated: false, failed: false };
    }
    cursor = previousLastOpenTime + duration;
  }

  return { candles: allCandles, malformedCount, truncated: false, failed: false };
}
