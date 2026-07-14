// Phase 2 confidence enrichment — the ONLY function allowed to change confidence
// after detectSetup(). Mechanically guaranteed to touch nothing else: every
// other RawSetup field is spread through unchanged (design §4). Called from
// engine.ts between detectSetup() and riskGate().
import type { RawSetup } from "./setup";
import type { MacdResult } from "./macd";
import type { BollingerResult } from "./bollinger";
import type { MultiTimeframeResult } from "./multi-timeframe";

export interface EnrichmentInputs {
  macd: MacdResult;
  bollinger: BollingerResult;
  confirmation: MultiTimeframeResult | null;
}

function macdAdjustment(
  direction: RawSetup["direction"],
  result: MacdResult,
): { points: number; reason: string } {
  if (result.macdLine === null || result.signalLine === null) {
    return { points: 0, reason: "MACD unavailable (insufficient bars) — no contribution." };
  }
  const confirms = direction === "LONG" ? result.macdLine > result.signalLine : result.macdLine < result.signalLine;
  return confirms
    ? { points: 10, reason: `MACD confirms ${direction.toLowerCase()} momentum (+10).` }
    : { points: -10, reason: `MACD contradicts ${direction.toLowerCase()} momentum (-10).` };
}

function bollingerAdjustment(
  direction: RawSetup["direction"],
  result: BollingerResult,
): { points: number; reason: string } {
  if (result.percentB === null) {
    return { points: 0, reason: "Bollinger Bands unavailable (flat/insufficient) — no contribution." };
  }
  const nearLower = result.percentB < 0.2;
  const nearUpper = result.percentB > 0.8;
  if (direction === "LONG") {
    if (nearLower) return { points: 10, reason: "Price near the lower Bollinger Band — favorable pullback entry (+10)." };
    if (nearUpper) return { points: -10, reason: "Price near the upper Bollinger Band — extended/chasing (-10)." };
  } else {
    if (nearUpper) return { points: 10, reason: "Price near the upper Bollinger Band — favorable bounce entry for a short (+10)." };
    if (nearLower) return { points: -10, reason: "Price near the lower Bollinger Band — already extended down (-10)." };
  }
  return { points: 0, reason: "Price within the middle Bollinger range — no mean-reversion edge either way." };
}

export function applyPhase2Enrichment(
  rawSetup: RawSetup | null,
  extras: EnrichmentInputs,
): RawSetup | null {
  if (rawSetup === null) return null;

  const macdResult = macdAdjustment(rawSetup.direction, extras.macd);
  const bbResult = bollingerAdjustment(rawSetup.direction, extras.bollinger);
  const tfPoints = extras.confirmation?.adjustment ?? 0;
  const tfReasoning = extras.confirmation?.reasoning ?? [
    "Multi-timeframe confirmation unavailable — no contribution.",
  ];

  const confidence = Math.max(
    0,
    Math.min(100, rawSetup.confidence + macdResult.points + bbResult.points + tfPoints),
  );

  return {
    ...rawSetup,
    confidence,
    reasoning: [...rawSetup.reasoning, macdResult.reason, bbResult.reason, ...tfReasoning],
  };
}
