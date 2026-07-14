// Engine analysis tests — hand-authored, deterministic candle fixtures. No network,
// no randomness, no LLM. Uses the pure `buildSignalFromCandles` seam so every case
// is a total function of its input array.
import { describe, it, expect } from "vitest";
import { buildSignalFromCandles } from "@/lib/trading-signals/engine";
import { detectSetup, type Indicators } from "@/lib/trading-signals/setup";
import { riskGate } from "@/lib/trading-signals/risk-gate";
import type { Candle, CandleSeries } from "@/lib/market-data/candles";
import {
  MAX_STOP_DISTANCE_FRAC,
  MIN_CONFIDENCE,
  MIN_RR,
  TP1_R_MULT,
} from "@/lib/trading-signals/config";
import type { TradingSignal } from "@/lib/trading-signals/types";
import { TIMEFRAME_DURATION_MS } from "@/lib/trading-signals/candle-closed";

const AT = "2026-07-13T00:00:00.000Z";
const AT_MS = Date.parse(AT);
const FOUR_HOUR_MS = TIMEFRAME_DURATION_MS["4h"];
const WIGGLE = 0.5;

/** Evenly spaced values from `from` to `to`, `n` points inclusive. */
function linspace(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1));
  return out;
}

/**
 * Build candles from a close path; high/low derived with a constant wiggle.
 * openTime is realistic (spaced by the 4h timeframe, ending exactly when the
 * last candle closes at AT_MS) so Phase 2's closed/stale filtering treats
 * these fixtures as a normal live series. openTime is not read by any
 * indicator computation (only close/high/low/volume are), so this changes
 * nothing about what these fixtures test — only whether they pass the gate.
 */
function candlesFromCloses(closes: number[], lastVolumeHigh: boolean): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const isLast = i === closes.length - 1;
    return {
      openTime: AT_MS - (closes.length - i) * FOUR_HOUR_MS,
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

  // Unit-level: with ATR unavailable AND no valid swing level, the stop cannot be
  // computed, so detectSetup leaves stopLoss null and the gate VETOes -> WAIT. (This
  // must be exercised at the pure level: ≥60 real bars normally make ATR available,
  // so the fallback would otherwise supply a stop.)
  it("missing stop (atr null + no swing) => stopLoss null => WAIT (unit)", () => {
    const ind: Indicators = {
      lastClose: 120,
      smaFast: 118,
      smaSlow: 110,
      emaFast: 119,
      emaSlow: 112,
      rsi: 60,
      atr: null,
      volumeAvg: 100,
      lastVolume: 130,
      swingHigh: null,
      swingLow: null,
    };
    const setup = detectSetup(ind);
    expect(setup).not.toBeNull();
    expect(setup!.direction).toBe("LONG");
    expect(setup!.stopLoss).toBeNull();
    expect(setup!.primaryTarget).toBeNull();
    expect(setup!.riskRewardRatio).toBeNull();
    expect(setup!.qualityOk).toBe(false);
    const gate = riskGate(setup);
    expect(gate.approved).toBe(false);
    expect(gate.direction).toBe("WAIT");
    expect(gate.reasoning.some((r) => /no structural stop-loss/i.test(r))).toBe(true);
  });

  // Reworked (behavior intentionally evolved): a poor STRUCTURAL R:R no longer WAITs
  // unconditionally. The engine first tries a risk-multiple TP fallback; it only stays
  // WAIT when that fallback is invalid — here because the stop sits > MAX_STOP_DISTANCE
  // from entry (too far to rescue). The WAIT now carries a diagnostic observed R:R and a
  // suggested tighter pullback entry near support.
  it("poor structural R:R + stop too far (no valid fallback) => WAIT with diagnostics", () => {
    const closes = [
      ...linspace(100, 180, 60), // 0..59 uptrend
      ...linspace(180, 160, 7).slice(1), // 60..65 deep pullback -> swing low ~160 (far stop)
      ...linspace(160, 180, 9).slice(1), // 66..73 rally -> swing high ~180 (near target)
      ...linspace(180, 178, 7).slice(1), // 74..79 tiny fade -> entry ~178
    ];
    const sig = buildSignalFromCandles(series(closes), AT);
    expect(sig.direction).toBe("WAIT");
    // Structural target is close (poor R:R) and the stop is > 10% from entry, so the
    // risk-multiple fallback is NOT stretched to rescue it: stays WAIT.
    expect(sig.observedRiskReward).not.toBeNull();
    expect(sig.observedRiskReward!).toBeLessThan(MIN_RR);
    expect(sig.suggestedEntry).not.toBeNull();
    expect(sig.suggestedEntry!.low).toBeLessThan(sig.suggestedEntry!.high);
    // Pullback zone must sit BELOW the current price (~178) for a LONG-context entry.
    expect(sig.suggestedEntry!.high).toBeLessThan(178);
    expect(sig.reasoning.some((r) => /pullback toward/i.test(r))).toBe(true);
    expect(sig.invalidationCondition).toMatch(/pullback toward the suggested entry zone/i);
    assertSignalShape(sig);
  });
});

// Unit-level poor-R:R behavior with hand-built Indicators — precise, deterministic.
describe("detectSetup — poor structural R:R handling", () => {
  it("poor structural R:R but tight stop => actionable via risk-multiple fallback", () => {
    // LONG: aligned uptrend, swing low just below entry (tight stop, risk ≈ 2% of entry),
    // swing high just above entry (structural reward tiny => poor structural R:R). Because
    // the stop is well within the MAX_STOP_DISTANCE cap, the risk-multiple TP is adopted.
    const ind: Indicators = {
      lastClose: 100,
      smaFast: 101,
      smaSlow: 98,
      emaFast: 100.5,
      emaSlow: 99,
      rsi: 60,
      atr: 1,
      volumeAvg: 100,
      lastVolume: 130,
      swingHigh: 101.5, // structural target just above -> reward ~1.5
      swingLow: 98, // structural stop ~98 - buffer -> risk ~2.1 (2% of entry)
    };
    const setup = detectSetup(ind);
    expect(setup).not.toBeNull();
    expect(setup!.direction).toBe("LONG");
    // Structural R:R was poor and recorded as a diagnostic...
    expect(setup!.observedRiskReward).not.toBeNull();
    expect(setup!.observedRiskReward!).toBeLessThan(MIN_RR);
    // ...but the fallback rescued it to an actionable 1.5R signal.
    expect(setup!.primaryTarget).not.toBeNull();
    expect(setup!.riskRewardRatio).toBe(TP1_R_MULT);
    expect(setup!.riskRewardRatio!).toBeGreaterThanOrEqual(MIN_RR);
    expect(setup!.qualityOk).toBe(true);
    expect(setup!.suggestedEntry).toBeNull();
    // Sanity: the tight stop really is within the distance cap.
    const risk = ind.lastClose! - setup!.stopLoss!;
    expect(risk / ind.lastClose!).toBeLessThanOrEqual(MAX_STOP_DISTANCE_FRAC);
    // TP labels advertise the risk-multiple (not structural) origin.
    expect(setup!.takeProfit.some((tp) => /risk-multiple/i.test(tp.label))).toBe(true);
    const gate = riskGate(setup);
    expect(gate.approved).toBe(true);
    expect(gate.direction).toBe("LONG");
  });

  it("poor structural R:R + stop too far => WAIT with suggested entry ABOVE (SHORT)", () => {
    // SHORT: aligned downtrend. Swing high far above entry (stop ~18% away => beyond cap),
    // swing low just below entry (tiny structural reward => poor R:R). Fallback rejected.
    const ind: Indicators = {
      lastClose: 100,
      smaFast: 100,
      smaSlow: 105,
      emaFast: 101,
      emaSlow: 104,
      rsi: 40,
      atr: 1,
      volumeAvg: 100,
      lastVolume: 130,
      swingHigh: 118, // structural stop far above -> risk ~18 (18% of entry, > cap)
      swingLow: 99, // structural target just below -> reward ~1 (poor R:R)
    };
    const setup = detectSetup(ind);
    expect(setup).not.toBeNull();
    expect(setup!.direction).toBe("SHORT");
    // No actionable target/R:R -> the gate will WAIT.
    expect(setup!.primaryTarget).toBeNull();
    expect(setup!.riskRewardRatio).toBeNull();
    expect(setup!.qualityOk).toBe(false);
    // Diagnostics present: poor observed R:R + a tighter retest zone near resistance.
    expect(setup!.observedRiskReward).not.toBeNull();
    expect(setup!.observedRiskReward!).toBeLessThan(MIN_RR);
    expect(setup!.suggestedEntry).not.toBeNull();
    expect(setup!.suggestedEntry!.low).toBeLessThan(setup!.suggestedEntry!.high);
    // SHORT-context: the retest zone sits ABOVE the current entry zone.
    expect(setup!.suggestedEntry!.low).toBeGreaterThan(setup!.entryZone.high);
    const gate = riskGate(setup);
    expect(gate.approved).toBe(false);
    expect(gate.direction).toBe("WAIT");
  });

  it("MIN_RR is unchanged (still 1.5)", () => {
    expect(MIN_RR).toBe(1.5);
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

  it("clean uptrend, no structural levels => Phase 2 WAIT via crossed confidence gate (was LONG pre-Phase-2)", () => {
    // Monotonic rise: no swing pivots form, so both structural stop and target are
    // absent. With ≥60 bars ATR is available, so the volatility fallback supplies a
    // stop and TP1 at 1.5R (== MIN_RR). detectSetup()'s OWN confidence is 70,
    // unchanged (see the pinned baseline in trading-signals-detect-setup-baseline
    // .test.ts, fixture "clean uptrend, no structural levels, ATR fallback").
    //
    // Phase 2 documented, intentional change: this exact fixture's monotonic
    // ramp keeps price pinned at the top of a rolling 20-bar window for its
    // entire length, which is a genuine "extended/chasing" mean-reversion read
    // (Bollinger %B > 0.8, -10) and produces a MACD histogram on the contrary
    // side of zero for a perfectly linear ramp (see the emaSeries/macd tests'
    // steady-state-convergence finding, -10). No confirmation data is passed
    // to this 2-argument call, so multi-timeframe contributes 0. Final
    // confidence: 70 - 10 (MACD contradicts) - 10 (Bollinger extended) + 0
    // (confirmation unavailable) = 50, below MIN_CONFIDENCE (55) -> WAIT.
    // This is an intentional confidence-gate crossing, not a defect: entry
    // zone, stop, target, and R:R math (detectSetup's own output) are
    // unchanged; only the final gate outcome moved, exactly as designed.
    const sig = buildSignalFromCandles(series(linspace(100, 180, 70)), AT);
    expect(sig.direction).toBe("WAIT");
    expect(sig.source).toBe("analysis");
    expect(sig.confidence).toBe(50);
    expect(sig.reasoning).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/ATR-based stop/i),
        "MACD contradicts long momentum (-10).",
        "Price near the upper Bollinger Band — extended/chasing (-10).",
        "1h confirmation: unavailable.",
        "1d confirmation: unavailable.",
        expect.stringMatching(/VETO: confidence 50 below floor 55/),
      ]),
    );
    assertSignalShape(sig);
  });

  it("clean downtrend, no structural levels => SHORT via ATR stop + R-multiple TP", () => {
    // Mirror of the LONG ATR-fallback case: a monotonic decline forms no pivots.
    const sig = buildSignalFromCandles(series(linspace(200, 120, 70)), AT);
    expect(sig.direction).toBe("SHORT");
    expect(sig.source).toBe("analysis");
    expect(sig.entryZone).not.toBeNull();
    expect(sig.stopLoss).not.toBeNull();
    expect(sig.stopLoss!).toBeGreaterThan(sig.entryZone!.high);
    expect(sig.takeProfit.length).toBeGreaterThanOrEqual(1);
    expect(sig.takeProfit[0].price).toBeLessThan(sig.entryZone!.low);
    expect(sig.riskRewardRatio!).toBeGreaterThanOrEqual(MIN_RR);
    expect(sig.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(sig.reasoning.some((r) => /ATR-based stop/i.test(r))).toBe(true);
    expect(sig.invalidationCondition).toMatch(/above the stop-loss/i);
    assertSignalShape(sig);
  });
});
