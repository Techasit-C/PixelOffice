import { describe, it, expect } from "vitest";
import { emaSeries, ema } from "@/lib/trading-signals/indicators";

describe("emaSeries", () => {
  it("matches the scalar ema() at the final index", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const period = 3;
    const series = emaSeries(values, period);
    expect(series[series.length - 1]).toBeCloseTo(ema(values, period)!, 10);
  });

  it("returns null before the seed index, then the running EMA", () => {
    const series = emaSeries([1, 2, 3, 4, 5], 3);
    expect(series[0]).toBeNull();
    expect(series[1]).toBeNull();
    expect(series[2]).toBeCloseTo(2, 10);
    expect(series[3]).toBeCloseTo(3, 10);
    expect(series[4]).toBeCloseTo(4, 10);
  });

  it("returns all nulls when there are fewer values than the period", () => {
    expect(emaSeries([1, 2], 5)).toEqual([null, null]);
  });

  it("returns an empty array for an empty input", () => {
    expect(emaSeries([], 3)).toEqual([]);
  });
});
