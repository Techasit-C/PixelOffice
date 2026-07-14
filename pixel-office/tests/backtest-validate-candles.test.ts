import { describe, it, expect } from "vitest";
import type { Candle } from "@/lib/market-data/candles";
import { validateCandles, checkCoverage } from "@/lib/backtest/validate-candles";

const H = 3_600_000; // 1h duration, used as durationMs for compact fixtures
function c(openTime: number, open: number, high: number, low: number, close: number, volume = 1): Candle {
  return { openTime, open, high, low, close, volume };
}

describe("validateCandles — OHLC sanity", () => {
  it("drops a row where low > high, and counts it", () => {
    const { candles, report } = validateCandles(
      [c(0, 10, 9, 11, 10), c(H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.length).toBe(1);
    expect(report.invalidOhlcCount).toBe(1);
  });

  it("drops a row with a non-positive price or negative volume", () => {
    const { candles, report } = validateCandles(
      [c(0, 0, 1, 0, 1), c(H, 1, 1, 1, 1, -5), c(2 * H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.length).toBe(1);
    expect(report.invalidOhlcCount).toBe(2);
  });

  it("drops a row whose open/close falls outside [low, high]", () => {
    const { candles, report } = validateCandles(
      [c(0, 15, 12, 8, 10), c(H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.length).toBe(1);
    expect(report.invalidOhlcCount).toBe(1);
  });
});

describe("validateCandles — grid alignment", () => {
  it("rejects a row whose openTime does not align to durationMs", () => {
    const { candles, report } = validateCandles(
      [c(0, 10, 12, 8, 11), c(H + 1, 10, 12, 8, 11), c(2 * H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.map((x) => x.openTime)).toEqual([0, 2 * H]);
    expect(report.invalidOhlcCount).toBe(1);
  });
});

describe("validateCandles — sort/reorder reporting", () => {
  it("sorts unordered input and reports the reorder", () => {
    const { candles, report } = validateCandles(
      [c(2 * H, 10, 12, 8, 11), c(0, 10, 12, 8, 11), c(H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.map((x) => x.openTime)).toEqual([0, H, 2 * H]);
    expect(report.reordered).toBe(true);
    expect(report.reorderCount).toBeGreaterThan(0);
  });

  it("does not flag already-sorted input as reordered", () => {
    const { report } = validateCandles([c(0, 10, 12, 8, 11), c(H, 10, 12, 8, 11)], H);
    expect(report.reordered).toBe(false);
    expect(report.reorderCount).toBe(0);
  });
});

describe("validateCandles — duplicate timestamps", () => {
  it("collapses byte-identical duplicates with a warning count, keeping one row", () => {
    const { candles, report } = validateCandles(
      [c(0, 10, 12, 8, 11), c(0, 10, 12, 8, 11), c(H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.length).toBe(2);
    expect(report.exactDuplicateCount).toBe(1);
    expect(report.conflictingDuplicateCount).toBe(0);
  });

  it("counts conflicting duplicates (same timestamp, different OHLCV) without silently picking one", () => {
    const { report } = validateCandles(
      [c(0, 10, 12, 8, 11), c(0, 99, 100, 98, 99), c(H, 10, 12, 8, 11)],
      H,
    );
    expect(report.conflictingDuplicateCount).toBe(2);
    expect(report.exactDuplicateCount).toBe(0);
  });
});

describe("validateCandles — gap detection", () => {
  it("records a gap between non-contiguous consecutive candles, never interpolating", () => {
    const { candles, report } = validateCandles(
      [c(0, 10, 12, 8, 11), c(3 * H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.length).toBe(2); // no synthetic candle inserted
    expect(report.gapCount).toBe(2); // two missing bars (at H and 2H)
    expect(report.gaps).toEqual([{ after: 0, before: 3 * H, missingBars: 2 }]);
  });

  it("reports zero gaps for a fully contiguous series", () => {
    const { report } = validateCandles([c(0, 10, 12, 8, 11), c(H, 10, 12, 8, 11)], H);
    expect(report.gapCount).toBe(0);
    expect(report.gaps).toEqual([]);
  });
});

describe("checkCoverage", () => {
  it("returns null when the fetched range fully covers the requested window", () => {
    const candles = [c(0, 10, 12, 8, 11), c(H, 10, 12, 8, 11), c(2 * H, 10, 12, 8, 11)];
    expect(checkCoverage(candles, 0, 2 * H, H)).toBeNull();
  });

  it("reports a shortfall when the fetched data starts later than requested", () => {
    const candles = [c(5 * H, 10, 12, 8, 11)];
    const shortfall = checkCoverage(candles, 0, 6 * H, H);
    expect(shortfall).not.toBeNull();
    expect(shortfall!.actualStart).toBe(5 * H);
  });

  it("reports a shortfall (empty result) when no candles were returned at all", () => {
    const shortfall = checkCoverage([], 0, 6 * H, H);
    expect(shortfall).toEqual({ requestedStart: 0, requestedEnd: 6 * H, actualStart: null, actualEnd: null });
  });
});
