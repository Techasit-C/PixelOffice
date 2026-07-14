import { describe, it, expect } from "vitest";
import {
  deriveConfirmationState,
  scoreConfirmation,
  confirmMultiTimeframe,
  mapWithConcurrency,
} from "@/lib/trading-signals/multi-timeframe";
import { CONFIRMATION_MIN_BARS } from "@/lib/trading-signals/config";
import type { Candle } from "@/lib/market-data/candles";

const NOW = 1_000_000_000_000;
const HOUR = 60 * 60_000;

function trendingCandles(n: number, startClose: number, step: number, now: number, tfDuration: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = startClose + i * step;
    return {
      openTime: now - (n - i) * tfDuration,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 10,
    };
  });
}

describe("deriveConfirmationState", () => {
  it("is UNAVAILABLE when there are fewer than CONFIRMATION_MIN_BARS closed candles", () => {
    const candles = trendingCandles(CONFIRMATION_MIN_BARS - 1, 100, 1, NOW, HOUR);
    expect(deriveConfirmationState(candles, "1h", NOW, "LONG")).toBe("UNAVAILABLE");
  });

  it("is ALIGNED when the timeframe's bias matches the primary direction", () => {
    const candles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 100, 1, NOW, HOUR);
    expect(deriveConfirmationState(candles, "1h", NOW, "LONG")).toBe("ALIGNED");
  });

  it("is OPPOSITE when the timeframe's bias contradicts the primary direction", () => {
    const candles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 200, -1, NOW, HOUR);
    expect(deriveConfirmationState(candles, "1h", NOW, "LONG")).toBe("OPPOSITE");
  });

  it("is NEUTRAL when the timeframe shows no directional bias", () => {
    const candles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 100, 0, NOW, HOUR);
    expect(deriveConfirmationState(candles, "1h", NOW, "LONG")).toBe("NEUTRAL");
  });

  it("is UNAVAILABLE when the data is stale", () => {
    const candles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 100, 1, NOW - 100 * HOUR, HOUR);
    expect(deriveConfirmationState(candles, "1h", NOW, "LONG")).toBe("UNAVAILABLE");
  });
});

describe("scoreConfirmation — exhaustive 16-combination table", () => {
  const STATES = ["ALIGNED", "NEUTRAL", "UNAVAILABLE", "OPPOSITE"] as const;
  const EXPECTED: Record<string, Record<string, number>> = {
    ALIGNED: { ALIGNED: 15, NEUTRAL: 5, UNAVAILABLE: 5, OPPOSITE: -15 },
    NEUTRAL: { ALIGNED: 5, NEUTRAL: 0, UNAVAILABLE: 0, OPPOSITE: -15 },
    UNAVAILABLE: { ALIGNED: 5, NEUTRAL: 0, UNAVAILABLE: 0, OPPOSITE: -15 },
    OPPOSITE: { ALIGNED: -15, NEUTRAL: -15, UNAVAILABLE: -15, OPPOSITE: -15 },
  };

  for (const oneHour of STATES) {
    for (const oneDay of STATES) {
      it(`1h=${oneHour}, 1d=${oneDay} -> ${EXPECTED[oneHour][oneDay]}`, () => {
        expect(scoreConfirmation(oneHour, oneDay)).toBe(EXPECTED[oneHour][oneDay]);
      });
    }
  }

  it("a conflict on BOTH timeframes still applies -15 exactly once, not -30", () => {
    expect(scoreConfirmation("OPPOSITE", "OPPOSITE")).toBe(-15);
  });
});

describe("confirmMultiTimeframe", () => {
  it("combines both timeframes and reports both states in reasoning", () => {
    const oneHourCandles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 100, 1, NOW, HOUR);
    const oneDayCandles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 100, 1, NOW, 24 * HOUR);
    const result = confirmMultiTimeframe({ oneHourCandles, oneDayCandles }, "LONG", NOW);
    expect(result.oneHour).toBe("ALIGNED");
    expect(result.oneDay).toBe("ALIGNED");
    expect(result.adjustment).toBe(15);
    expect(result.reasoning.join(" ")).toMatch(/1h/i);
    expect(result.reasoning.join(" ")).toMatch(/1d/i);
  });

  it("treats empty candle arrays as UNAVAILABLE for both, adjustment 0", () => {
    const result = confirmMultiTimeframe({ oneHourCandles: [], oneDayCandles: [] }, "LONG", NOW);
    expect(result.oneHour).toBe("UNAVAILABLE");
    expect(result.oneDay).toBe("UNAVAILABLE");
    expect(result.adjustment).toBe(0);
  });
});

describe("mapWithConcurrency", () => {
  it("runs every item and preserves result order regardless of completion order", async () => {
    const items = [30, 10, 20];
    const results = await mapWithConcurrency(items, 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("never runs more than `limit` items concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 8 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return i;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
