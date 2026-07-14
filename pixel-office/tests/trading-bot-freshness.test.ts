import { describe, it, expect } from "vitest";
import { checkCandleFreshness, TIMEFRAME_DURATION_MS, CANDLE_STALENESS_GRACE_MS } from "@/lib/trading-bot/freshness";
import type { Candle } from "@/lib/market-data/candles";

function candleAt(openTime: number): Candle {
  return { openTime, open: 100, high: 101, low: 99, close: 100, volume: 10 };
}

describe("checkCandleFreshness", () => {
  it("rejects an empty candle array", () => {
    const result = checkCandleFreshness([], "4h", Date.now());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STALE_CANDLE_DATA");
  });

  it("accepts a candle within one timeframe + grace period", () => {
    const now = 10_000_000;
    const maxAge = TIMEFRAME_DURATION_MS["4h"] + CANDLE_STALENESS_GRACE_MS;
    const candles = [candleAt(now - (maxAge - 1))];
    expect(checkCandleFreshness(candles, "4h", now).ok).toBe(true);
  });

  it("rejects a candle older than one timeframe + grace period", () => {
    const now = 10_000_000;
    const maxAge = TIMEFRAME_DURATION_MS["4h"] + CANDLE_STALENESS_GRACE_MS;
    const candles = [candleAt(now - (maxAge + 1))];
    const result = checkCandleFreshness(candles, "4h", now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STALE_CANDLE_DATA");
  });

  it("a 3h-old candle on a 4h timeframe is NOT stale (within the ~4h05m ceiling)", () => {
    const now = 10_000_000;
    const threeHoursMs = 3 * 60 * 60_000;
    const candles = [candleAt(now - threeHoursMs)];
    expect(checkCandleFreshness(candles, "4h", now).ok).toBe(true);
  });
});
