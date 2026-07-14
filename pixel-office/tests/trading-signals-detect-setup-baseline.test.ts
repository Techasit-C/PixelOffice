// PINNED BASELINE — captures detectSetup()'s exact current output via snapshot,
// committed before any Phase 2 code exists. detectSetup() is never modified by
// Phase 2 (design §4); this test proves that mechanically, not just by claim.
import { describe, it, expect } from "vitest";
import { computeIndicators, detectSetup } from "@/lib/trading-signals/setup";
import type { Candle } from "@/lib/market-data/candles";

function linspace(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1));
  return out;
}

function candlesFromCloses(closes: number[], lastVolumeHigh: boolean): Candle[] {
  const WIGGLE = 0.5;
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const isLast = i === closes.length - 1;
    return {
      openTime: i,
      open,
      high: Math.max(open, close) + WIGGLE,
      low: Math.min(open, close) - WIGGLE,
      close,
      volume: isLast && lastVolumeHigh ? 500 : 100,
    };
  });
}

describe("detectSetup — pinned baseline (Phase 2 regression guard)", () => {
  it("clean uptrend + pullback (LONG) — baseline snapshot", () => {
    const closes = [
      ...linspace(100, 170, 64),
      ...linspace(170, 158, 9).slice(1),
      ...linspace(158, 162, 9).slice(1),
    ];
    const ind = computeIndicators(candlesFromCloses(closes, true));
    expect(detectSetup(ind)).toMatchSnapshot();
  });

  it("downtrend + bounce (SHORT) — baseline snapshot", () => {
    const closes = [
      ...linspace(200, 140, 64),
      ...linspace(140, 152, 9).slice(1),
      ...linspace(152, 148, 9).slice(1),
    ];
    const ind = computeIndicators(candlesFromCloses(closes, true));
    expect(detectSetup(ind)).toMatchSnapshot();
  });

  it("flat/no-bias input — low-quality candidate, qualityOk false (baseline)", () => {
    const closes = linspace(100, 101, 80);
    const ind = computeIndicators(candlesFromCloses(closes, false));
    expect(detectSetup(ind)).toMatchSnapshot();
  });

  it("clean uptrend, no structural levels, ATR fallback — baseline snapshot", () => {
    const closes = linspace(100, 180, 70);
    const ind = computeIndicators(candlesFromCloses(closes, true));
    expect(detectSetup(ind)).toMatchSnapshot();
  });
});
