import { describe, it, expect } from "vitest";
import {
  isClosed,
  dropUnclosedTrailing,
  toClosedSeries,
  TIMEFRAME_DURATION_MS,
} from "@/lib/trading-signals/candle-closed";
import { STALE_GRACE_MS } from "@/lib/trading-signals/config";
import type { Candle } from "@/lib/market-data/candles";

function candleAt(openTime: number): Candle {
  return { openTime, open: 100, high: 101, low: 99, close: 100, volume: 10 };
}

describe("isClosed", () => {
  it("is closed exactly at openTime + duration (boundary inclusive)", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    expect(isClosed(candleAt(0), "4h", duration)).toBe(true);
  });
  it("is not closed one ms before that boundary", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    expect(isClosed(candleAt(0), "4h", duration - 1)).toBe(false);
  });
});

describe("dropUnclosedTrailing", () => {
  it("drops a single trailing unclosed candle", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const now = 10_000_000;
    const candles = [candleAt(now - 3 * duration), candleAt(now - 2 * duration), candleAt(now - 100)];
    expect(dropUnclosedTrailing(candles, "4h", now).length).toBe(2);
  });

  it("drops multiple trailing unclosed candles", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const now = 10_000_000;
    // A defensive case: a provider should never really return two forming
    // candles, but the loop must still strip ALL trailing unclosed entries,
    // not just the last one. Both trailing candles opened well within the
    // last `duration`, so neither is closed yet.
    const candles = [candleAt(now - 3 * duration), candleAt(now - 200), candleAt(now - 100)];
    expect(dropUnclosedTrailing(candles, "4h", now).length).toBe(1);
  });

  it("keeps every candle when the last one is already closed", () => {
    const duration = TIMEFRAME_DURATION_MS["1h"];
    const now = 10_000_000;
    const candles = [candleAt(now - 3 * duration), candleAt(now - 2 * duration - 1)];
    expect(dropUnclosedTrailing(candles, "1h", now).length).toBe(2);
  });
});

describe("toClosedSeries — corrected staleness boundaries", () => {
  it("is not stale immediately after the latest candle closes", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const openTime = 0;
    const now = openTime + duration;
    expect(toClosedSeries([candleAt(openTime)], "4h", now).stale).toBe(false);
  });

  it("is NOT stale five minutes into the next (still-forming) candle — the corrected bug case", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const openTime = 0;
    const formingCandleOpen = openTime + duration;
    const now = formingCandleOpen + 5 * 60_000;
    const result = toClosedSeries([candleAt(openTime), candleAt(formingCandleOpen)], "4h", now);
    expect(result.closedCandles.length).toBe(1);
    expect(result.stale).toBe(false);
  });

  it("is fresh exactly at the next expected close plus grace", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const openTime = 0;
    const now = openTime + 2 * duration + STALE_GRACE_MS;
    expect(toClosedSeries([candleAt(openTime)], "4h", now).stale).toBe(false);
  });

  it("is stale one millisecond after that boundary", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const openTime = 0;
    const now = openTime + 2 * duration + STALE_GRACE_MS + 1;
    expect(toClosedSeries([candleAt(openTime)], "4h", now).stale).toBe(true);
  });

  it("treats a genuinely stalled feed as stale", () => {
    const duration = TIMEFRAME_DURATION_MS["1d"];
    const now = 10 * duration;
    expect(toClosedSeries([candleAt(0)], "1d", now).stale).toBe(true);
  });

  it("treats an empty candle array as stale/unavailable", () => {
    const result = toClosedSeries([], "1h", 1000);
    expect(result.stale).toBe(true);
    expect(result.closedCandles).toEqual([]);
  });

  it("applies the identical rule to 1h, 4h, and 1d", () => {
    for (const tf of ["1h", "4h", "1d"] as const) {
      const duration = TIMEFRAME_DURATION_MS[tf];
      const freshNow = 0 + 2 * duration + STALE_GRACE_MS;
      expect(toClosedSeries([candleAt(0)], tf, freshNow).stale).toBe(false);
      expect(toClosedSeries([candleAt(0)], tf, freshNow + 1).stale).toBe(true);
    }
  });
});
