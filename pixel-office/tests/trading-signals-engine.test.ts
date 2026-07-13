// Engine analysis tests — hand-authored, deterministic candle fixtures. No network,
// no randomness, no LLM. Uses the pure `buildSignalFromCandles` seam so every case
// is a total function of its input array.
import { describe, it, expect } from "vitest";
import { buildSignalFromCandles } from "@/lib/trading-signals/engine";
import type { Candle, CandleSeries } from "@/lib/market-data/candles";
import { MIN_RR } from "@/lib/trading-signals/config";
import type { TradingSignal } from "@/lib/trading-signals/types";

const AT = "2026-07-13T00:00:00.000Z";
const WIGGLE = 0.5;

/** Evenly spaced values from `from` to `to`, `n` points inclusive. */
function linspace(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1));
  return out;
}

/** Build candles from a close path; high/low derived with a constant wiggle. */
function candlesFromCloses(closes: number[], lastVolumeHigh: boolean): Candle[] {
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

function series(closes: number[], lastVolumeHigh = true): CandleSeries {
  return {
    symbol: "BTC/USDT",
    timeframe: "4h",
    candles: candlesFromCloses(closes, lastVolumeHigh),
    source: "live",
    fetchedAt: 0,
  };
}

function assertSignalShape(sig: TradingSignal): void {
  expect(sig).toMatchObject({
    symbol: expect.any(String),
    timeframe: "4h",
    direction: expect.stringMatching(/^(LONG|SHORT|WAIT)$/),
    confidence: expect.any(Number),
    reasoning: expect.any(Array),
    invalidationCondition: expect.any(String),
    generatedAt: AT,
    source: expect.stringMatching(/^(analysis|mock|insufficient-data)$/),
  });
  expect(sig.reasoning.length).toBeGreaterThan(0);
}

describe("buildSignalFromCandles — degrade paths", () => {
  it("provider miss (source:insufficient) => WAIT / insufficient-data", () => {
    const s: CandleSeries = {
      symbol: "BTC/USDT",
      timeframe: "4h",
      candles: [],
      source: "insufficient",
      fetchedAt: 0,
    };
    const sig = buildSignalFromCandles(s, AT);
    expect(sig.direction).toBe("WAIT");
    expect(sig.source).toBe("insufficient-data");
    expect(sig.entryZone).toBeNull();
    expect(sig.stopLoss).toBeNull();
    expect(sig.takeProfit).toEqual([]);
    expect(sig.riskRewardRatio).toBeNull();
    assertSignalShape(sig);
  });

  it("too few bars (< MIN_BARS) => WAIT / insufficient-data", () => {
    const sig = buildSignalFromCandles(series(linspace(100, 110, 12)), AT);
    expect(sig.direction).toBe("WAIT");
    expect(sig.source).toBe("insufficient-data");
    assertSignalShape(sig);
  });
});

describe("buildSignalFromCandles — no-trade vetoes", () => {
  it("low confidence (flat drift) => WAIT / analysis with confidence veto", () => {
    // Near-flat slow drift: trend gap below the alignment threshold -> low confidence.
    const sig = buildSignalFromCandles(series(linspace(100, 101, 80), false), AT);
    expect(sig.direction).toBe("WAIT");
    expect(sig.source).toBe("analysis");
    expect(sig.reasoning.some((r) => /confidence \d+ below floor/i.test(r))).toBe(true);
    assertSignalShape(sig);
  });

  it("missing structural stop (monotonic rise) => WAIT with stop veto", () => {
    const sig = buildSignalFromCandles(series(linspace(100, 180, 70)), AT);
    expect(sig.direction).toBe("WAIT");
    expect(sig.stopLoss).toBeNull();
    expect(sig.reasoning.some((r) => /no structural stop-loss/i.test(r))).toBe(true);
    assertSignalShape(sig);
  });

  it("poor R:R (tiny reward vs large risk) => WAIT with R:R veto", () => {
    const closes = [
      ...linspace(100, 180, 60), // 0..59 uptrend
      ...linspace(180, 160, 7).slice(1), // 60..65 deep pullback -> swing low 160
      ...linspace(160, 180, 9).slice(1), // 66..73 rally -> swing high 180
      ...linspace(180, 178, 7).slice(1), // 74..79 tiny fade -> entry 178
    ];
    const sig = buildSignalFromCandles(series(closes), AT);
    expect(sig.direction).toBe("WAIT");
    expect(sig.reasoning.some((r) => /R:R .*below floor/i.test(r))).toBe(true);
    assertSignalShape(sig);
  });
});

describe("buildSignalFromCandles — approved setups", () => {
  it("clean uptrend + pullback to support => LONG with full levels and R:R >= floor", () => {
    const closes = [
      ...linspace(100, 170, 64), // 0..63 uptrend -> swing high 170
      ...linspace(170, 158, 9).slice(1), // 64..71 pullback -> swing low 158
      ...linspace(158, 162, 9).slice(1), // 72..79 bounce -> entry 162 (< 170, > 158)
    ];
    const sig = buildSignalFromCandles(series(closes), AT);
    expect(sig.direction).toBe("LONG");
    expect(sig.source).toBe("analysis");
    expect(sig.entryZone).not.toBeNull();
    expect(sig.stopLoss).not.toBeNull();
    expect(sig.takeProfit.length).toBeGreaterThanOrEqual(1);
    expect(sig.riskRewardRatio).not.toBeNull();
    expect(sig.riskRewardRatio!).toBeGreaterThanOrEqual(MIN_RR);
    expect(sig.confidence).toBeGreaterThanOrEqual(55);
    // Stop below entry zone; a take-profit above it.
    expect(sig.stopLoss!).toBeLessThan(sig.entryZone!.low);
    expect(sig.takeProfit[0].price).toBeGreaterThan(sig.entryZone!.high);
    expect(sig.invalidationCondition).toMatch(/below the stop-loss/i);
    assertSignalShape(sig);
  });

  it("downtrend + bounce to resistance => SHORT with full levels and R:R >= floor", () => {
    const closes = [
      ...linspace(200, 140, 64), // 0..63 downtrend -> swing low 140
      ...linspace(140, 152, 9).slice(1), // 64..71 bounce -> swing high 152
      ...linspace(152, 148, 9).slice(1), // 72..79 fade -> entry 148 (> 140, < 152)
    ];
    const sig = buildSignalFromCandles(series(closes), AT);
    expect(sig.direction).toBe("SHORT");
    expect(sig.source).toBe("analysis");
    expect(sig.stopLoss).not.toBeNull();
    expect(sig.riskRewardRatio!).toBeGreaterThanOrEqual(MIN_RR);
    // Stop above entry zone; a take-profit below it.
    expect(sig.stopLoss!).toBeGreaterThan(sig.entryZone!.high);
    expect(sig.takeProfit[0].price).toBeLessThan(sig.entryZone!.low);
    expect(sig.invalidationCondition).toMatch(/above the stop-loss/i);
    assertSignalShape(sig);
  });
});
