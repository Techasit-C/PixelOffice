import { describe, it, expect } from "vitest";
import {
  TIMEFRAME_DURATION_MS_4H,
  normalizeRange,
  isDecisionBar,
  isTradableBar,
  primaryFetchWindow,
  oneHourFetchWindow,
  oneDayFetchWindow,
} from "@/lib/backtest/candle-window";

const H4 = TIMEFRAME_DURATION_MS_4H; // 14,400,000

describe("normalizeRange", () => {
  it("rounds requestedStart UP and requestedEnd DOWN to the nearest 4h boundary", () => {
    const w = normalizeRange(1_000, H4 * 3 + 1_000, H4 * 10);
    expect(w.normalizedStart).toBe(H4); // ceil(1000/H4) * H4
    expect(w.normalizedEnd).toBe(H4 * 3); // floor((3*H4+1000)/H4) * H4
  });

  it("caps effectiveEndBoundary at latestFullyClosedBarBoundary when it is earlier", () => {
    const w = normalizeRange(0, H4 * 10, H4 * 4);
    expect(w.normalizedEnd).toBe(H4 * 10);
    expect(w.effectiveEndBoundary).toBe(H4 * 4);
  });

  it("leaves an already-boundary-aligned start/end unchanged", () => {
    const w = normalizeRange(H4 * 2, H4 * 5, H4 * 10);
    expect(w.normalizedStart).toBe(H4 * 2);
    expect(w.normalizedEnd).toBe(H4 * 5);
  });
});

// Worked example from spec §6.3: normalizedStart=08:00, effectiveEndBoundary=16:00
// (using H4-relative offsets: 08:00 == 2*H4 if the epoch origin is treated as 00:00).
describe("isDecisionBar / isTradableBar — spec §6.3 worked example", () => {
  const start = 2 * H4; // 08:00
  const end = 4 * H4; // 16:00 (effectiveEndBoundary)
  const window = { normalizedStart: start, normalizedEnd: end, effectiveEndBoundary: end };

  // Bar A: 04:00–08:00 (1*H4 to 2*H4)
  const A = { openTime: 1 * H4, closeTime: 2 * H4 };
  // Bar B: 08:00–12:00 (2*H4 to 3*H4)
  const B = { openTime: 2 * H4, closeTime: 3 * H4 };
  // Bar C: 12:00–16:00 (3*H4 to 4*H4)
  const C = { openTime: 3 * H4, closeTime: 4 * H4 };
  // Bar D (never fetched in production, but the classifier must still handle it):
  // 16:00–20:00 (4*H4 to 5*H4)
  const D = { openTime: 4 * H4, closeTime: 5 * H4 };

  it("Bar A is decision-only: produces the first signal, never tradable", () => {
    expect(isDecisionBar(A.closeTime, window)).toBe(true);
    expect(isTradableBar(A.openTime, A.closeTime, window)).toBe(false);
  });

  it("Bar B is both decision and tradable — the first tradable bar", () => {
    expect(isDecisionBar(B.closeTime, window)).toBe(true);
    expect(isTradableBar(B.openTime, B.closeTime, window)).toBe(true);
  });

  it("Bar C is tradable-only: valued/liquidated but produces no new signal", () => {
    expect(isDecisionBar(C.closeTime, window)).toBe(false);
    expect(isTradableBar(C.openTime, C.closeTime, window)).toBe(true);
  });

  it("Bar D is neither decision nor tradable — never eligible at/after the boundary", () => {
    expect(isDecisionBar(D.closeTime, window)).toBe(false);
    expect(isTradableBar(D.openTime, D.closeTime, window)).toBe(false);
  });

  it("a bar closing exactly at normalizedStart is a decision bar (boundary-inclusive)", () => {
    expect(isDecisionBar(start, window)).toBe(true);
  });

  it("a bar closing 1ms before normalizedStart is warm-up-only, not a decision bar", () => {
    expect(isDecisionBar(start - 1, window)).toBe(false);
  });
});

describe("fetch window helpers", () => {
  const normalizedStart = 100 * H4;
  const normalizedEnd = 110 * H4;

  it("primaryFetchWindow subtracts 60 bars of 4h pre-roll and ends 1ms before normalizedEnd", () => {
    const w = primaryFetchWindow(normalizedStart, normalizedEnd);
    expect(w.fetchStartTime).toBe(normalizedStart - 60 * H4);
    expect(w.fetchEndTime).toBe(normalizedEnd - 1);
  });

  it("oneHourFetchWindow subtracts 50 bars of 1h pre-roll", () => {
    const w = oneHourFetchWindow(normalizedStart, normalizedEnd);
    expect(w.fetchStartTime).toBe(normalizedStart - 50 * 3_600_000);
    expect(w.fetchEndTime).toBe(normalizedEnd - 1);
  });

  it("oneDayFetchWindow subtracts 50 bars of 1d pre-roll", () => {
    const w = oneDayFetchWindow(normalizedStart, normalizedEnd);
    expect(w.fetchStartTime).toBe(normalizedStart - 50 * 86_400_000);
    expect(w.fetchEndTime).toBe(normalizedEnd - 1);
  });
});
