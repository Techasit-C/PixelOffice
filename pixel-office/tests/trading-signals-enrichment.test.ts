import { describe, it, expect } from "vitest";
import { applyPhase2Enrichment } from "@/lib/trading-signals/enrichment";
import type { RawSetup } from "@/lib/trading-signals/setup";

function baseSetup(overrides: Partial<RawSetup> = {}): RawSetup {
  return {
    direction: "LONG",
    entryZone: { low: 99, high: 101 },
    stopLoss: 95,
    takeProfit: [{ price: 110, label: "TP1" }],
    primaryTarget: 110,
    riskRewardRatio: 2,
    observedRiskReward: 2,
    suggestedEntry: null,
    confidence: 50,
    reasoning: ["base reasoning"],
    qualityOk: true,
    ...overrides,
  };
}

const UNAVAILABLE = {
  macd: { macdLine: null, signalLine: null, histogram: null },
  bollinger: { middle: null, upper: null, lower: null, percentB: null },
  confirmation: null,
};

describe("applyPhase2Enrichment", () => {
  it("returns null unchanged when rawSetup is null (WAIT stays WAIT)", () => {
    expect(applyPhase2Enrichment(null, UNAVAILABLE)).toBeNull();
  });

  it("never changes direction, entryZone, stopLoss, takeProfit, primaryTarget, riskRewardRatio, observedRiskReward, suggestedEntry, or qualityOk", () => {
    const raw = baseSetup();
    const enriched = applyPhase2Enrichment(raw, UNAVAILABLE)!;
    expect(enriched.direction).toBe(raw.direction);
    expect(enriched.entryZone).toEqual(raw.entryZone);
    expect(enriched.stopLoss).toBe(raw.stopLoss);
    expect(enriched.takeProfit).toEqual(raw.takeProfit);
    expect(enriched.primaryTarget).toBe(raw.primaryTarget);
    expect(enriched.riskRewardRatio).toBe(raw.riskRewardRatio);
    expect(enriched.observedRiskReward).toBe(raw.observedRiskReward);
    expect(enriched.suggestedEntry).toBe(raw.suggestedEntry);
    expect(enriched.qualityOk).toBe(raw.qualityOk);
  });

  it("never reverses LONG to SHORT even under maximally negative contributors", () => {
    const raw = baseSetup({ direction: "LONG" });
    const enriched = applyPhase2Enrichment(raw, {
      macd: { macdLine: -1, signalLine: 0.5, histogram: -1.5 },
      bollinger: { middle: 100, upper: 110, lower: 90, percentB: 0.9 },
      confirmation: { oneHour: "OPPOSITE", oneDay: "OPPOSITE", adjustment: -15, reasoning: [] },
    })!;
    expect(enriched.direction).toBe("LONG");
  });

  it("never reverses SHORT to LONG even under maximally positive contributors", () => {
    const raw = baseSetup({ direction: "SHORT" });
    const enriched = applyPhase2Enrichment(raw, {
      macd: { macdLine: -1, signalLine: 0.5, histogram: -1.5 },
      bollinger: { middle: 100, upper: 110, lower: 90, percentB: 0.9 },
      confirmation: { oneHour: "ALIGNED", oneDay: "ALIGNED", adjustment: 15, reasoning: [] },
    })!;
    expect(enriched.direction).toBe("SHORT");
  });

  it("all-unavailable contributors leave confidence unchanged", () => {
    const raw = baseSetup({ confidence: 50 });
    expect(applyPhase2Enrichment(raw, UNAVAILABLE)!.confidence).toBe(50);
  });

  it("MACD confirming a LONG adds +10", () => {
    const raw = baseSetup({ confidence: 50, direction: "LONG" });
    const enriched = applyPhase2Enrichment(raw, {
      ...UNAVAILABLE,
      macd: { macdLine: 1, signalLine: 0.5, histogram: 0.5 },
    })!;
    expect(enriched.confidence).toBe(60);
  });

  it("MACD contradicting a LONG subtracts 10", () => {
    const raw = baseSetup({ confidence: 50, direction: "LONG" });
    const enriched = applyPhase2Enrichment(raw, {
      ...UNAVAILABLE,
      macd: { macdLine: -1, signalLine: 0.5, histogram: -1.5 },
    })!;
    expect(enriched.confidence).toBe(40);
  });

  it("Bollinger near the lower band adds +10 for LONG, subtracts 10 for SHORT", () => {
    const bollinger = { middle: 100, upper: 110, lower: 90, percentB: 0.1 };
    const longEnriched = applyPhase2Enrichment(baseSetup({ confidence: 50, direction: "LONG" }), { ...UNAVAILABLE, bollinger })!;
    const shortEnriched = applyPhase2Enrichment(baseSetup({ confidence: 50, direction: "SHORT" }), { ...UNAVAILABLE, bollinger })!;
    expect(longEnriched.confidence).toBe(60);
    expect(shortEnriched.confidence).toBe(40);
  });

  it("timeframe confirmation adjustment is applied directly", () => {
    const raw = baseSetup({ confidence: 50 });
    const enriched = applyPhase2Enrichment(raw, {
      ...UNAVAILABLE,
      confirmation: {
        oneHour: "ALIGNED",
        oneDay: "ALIGNED",
        adjustment: 15,
        reasoning: ["1h confirmation: aligned.", "1d confirmation: aligned."],
      },
    })!;
    expect(enriched.confidence).toBe(65);
    expect(enriched.reasoning).toEqual(
      expect.arrayContaining(["1h confirmation: aligned.", "1d confirmation: aligned."]),
    );
  });

  it("clamps confidence at 100 when contributors overflow", () => {
    const raw = baseSetup({ confidence: 95 });
    const enriched = applyPhase2Enrichment(raw, {
      macd: { macdLine: 1, signalLine: 0.5, histogram: 0.5 },
      bollinger: { middle: 100, upper: 110, lower: 90, percentB: 0.1 },
      confirmation: { oneHour: "ALIGNED", oneDay: "ALIGNED", adjustment: 15, reasoning: [] },
    })!;
    expect(enriched.confidence).toBe(100);
  });

  it("clamps confidence at 0 when contributors are maximally negative", () => {
    const raw = baseSetup({ confidence: 5, direction: "LONG" });
    const enriched = applyPhase2Enrichment(raw, {
      macd: { macdLine: -1, signalLine: 0.5, histogram: -1.5 },
      bollinger: { middle: 100, upper: 110, lower: 90, percentB: 0.9 },
      confirmation: { oneHour: "OPPOSITE", oneDay: "NEUTRAL", adjustment: -15, reasoning: [] },
    })!;
    expect(enriched.confidence).toBe(0);
  });
});
