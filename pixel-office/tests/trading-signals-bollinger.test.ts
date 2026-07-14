import { describe, it, expect } from "vitest";
import { bollingerBands } from "@/lib/trading-signals/bollinger";

function flat(n: number, value = 100): number[] {
  return new Array(n).fill(value);
}

/**
 * 19 prior closes with genuine internal spread (NOT all identical — a window
 * of 19-identical + 1-varying degenerates to a scale-invariant constant %B
 * regardless of the 20th value, verified empirically, so it cannot be used to
 * target a specific %B).
 */
function spreadPrior19(): number[] {
  return Array.from({ length: 19 }, (_, i) => 100 + Math.sin(i) * 3);
}

/**
 * Deterministic bisection (no randomness) to find a last-close value that
 * produces a given %B, given fixed prior closes. Necessary because the last
 * close is itself part of the window that DEFINES the bands, so bands
 * computed from one window cannot be reused as fixed targets for another.
 */
function solveLastCloseForPercentB(basePrior: number[], targetPercentB: number): number {
  let lo = 50;
  let hi = 200;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const pB = bollingerBands([...basePrior, mid]).percentB!;
    if (pB < targetPercentB) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe("bollingerBands", () => {
  it("is unavailable below the 20-bar warm-up floor", () => {
    expect(bollingerBands(flat(19))).toEqual({ middle: null, upper: null, lower: null, percentB: null });
  });

  it("collapses to unavailable %B when stdev is zero (flat closes) — never divides by zero", () => {
    const result = bollingerBands(flat(20));
    expect(result.middle).toBe(100);
    expect(result.percentB).toBeNull();
  });

  it("computes %B < 0 when price closes below the lower band", () => {
    const closes = [...flat(19, 100), 50];
    expect(bollingerBands(closes).percentB).toBeLessThan(0);
  });

  it("computes %B = 0.2 at the neutral/lower boundary (inclusive of neutral)", () => {
    const prior = spreadPrior19();
    const lastClose = solveLastCloseForPercentB(prior, 0.2);
    const result = bollingerBands([...prior, lastClose]);
    expect(result.percentB).toBeCloseTo(0.2, 6);
  });

  it("computes %B = 0.8 at the neutral/upper boundary", () => {
    const prior = spreadPrior19();
    const lastClose = solveLastCloseForPercentB(prior, 0.8);
    const result = bollingerBands([...prior, lastClose]);
    expect(result.percentB).toBeCloseTo(0.8, 6);
  });

  it("computes %B > 1 when price closes above the upper band", () => {
    const closes = [...flat(19, 100), 200];
    expect(bollingerBands(closes).percentB).toBeGreaterThan(1);
  });
});
