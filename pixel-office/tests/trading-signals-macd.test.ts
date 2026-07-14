import { describe, it, expect } from "vitest";
import { macd } from "@/lib/trading-signals/macd";
import { ema, emaSeries } from "@/lib/trading-signals/indicators";

function ramp(n: number, start = 100, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

describe("macd", () => {
  it("computes macdLine as EMA(12) - EMA(26) at the latest bar, cross-checked against the trusted scalar ema()", () => {
    const closes = ramp(40);
    const result = macd(closes);
    const expectedMacdLine = ema(closes, 12)! - ema(closes, 26)!;
    expect(result.macdLine).toBeCloseTo(expectedMacdLine, 6);
  });

  it("computes signalLine as EMA(9) of the compacted macd-line series, cross-checked via emaSeries", () => {
    const closes = ramp(40);
    const fast = emaSeries(closes, 12);
    const slow = emaSeries(closes, 26);
    const macdLineSeries = closes
      .map((_, i) => (fast[i] !== null && slow[i] !== null ? fast[i]! - slow[i]! : null))
      .filter((v): v is number => v !== null);
    const expectedSignal = ema(macdLineSeries, 9);
    const result = macd(closes);
    expect(result.signalLine).toBeCloseTo(expectedSignal!, 6);
    expect(result.histogram).toBeCloseTo(result.macdLine! - result.signalLine!, 10);
  });

  it("is unavailable (all null) below the 34-bar warm-up floor", () => {
    expect(macd(ramp(33))).toEqual({ macdLine: null, signalLine: null, histogram: null });
  });

  it("is available at exactly the 34-bar warm-up floor", () => {
    const result = macd(ramp(34));
    expect(result.macdLine).not.toBeNull();
    expect(result.signalLine).not.toBeNull();
  });

  it("an accelerating uptrend produces a positive histogram", () => {
    // A perfectly LINEAR ramp converges to a ~zero histogram at steady state
    // (MACD measures acceleration/convergence, and a constant slope has none)
    // — that is correct MACD behavior, not a bug. An accelerating trend (step
    // size growing bar over bar) has genuine positive curvature to detect.
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i * i * 0.05);
    const result = macd(closes);
    expect(result.histogram).toBeGreaterThan(0);
  });

  it("an accelerating downtrend produces a negative histogram", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 200 - i * i * 0.05);
    const result = macd(closes);
    expect(result.histogram).toBeLessThan(0);
  });
});
