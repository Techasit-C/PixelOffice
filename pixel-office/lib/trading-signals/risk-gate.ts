// Pure risk gate — the SOLE authority that turns a raw candidate into an approved
// direction or forces WAIT. This is a review step only: it approves/vetoes an
// OPINION about levels. It has no ability (and no imports) to place, size, or manage
// any position. Deterministic, no I/O.
import type { SignalDirection } from "./types";
import type { RawSetup } from "./setup";
import { MIN_CONFIDENCE, MIN_RR } from "./config";

export interface GateResult {
  approved: boolean;
  /** Approved direction, or "WAIT" when the gate vetoes. */
  direction: SignalDirection;
  reasoning: string[];
}

/**
 * Force WAIT when: no candidate, missing stop, RR below floor (or unknown), setup
 * quality low, or confidence below floor. Otherwise approve the candidate direction.
 * Always returns an honest reasoning trail explaining the decision.
 */
export function riskGate(setup: RawSetup | null): GateResult {
  if (setup === null) {
    return {
      approved: false,
      direction: "WAIT",
      reasoning: ["No directional edge: trend MAs are flat or core indicators unavailable."],
    };
  }

  const reasons: string[] = [];
  let veto = false;

  if (setup.stopLoss === null) {
    veto = true;
    reasons.push("VETO: no structural stop-loss — a trade that cannot be stopped is not sized.");
  }

  if (setup.riskRewardRatio === null) {
    veto = true;
    reasons.push("VETO: risk:reward could not be computed (missing target/stop).");
  } else if (setup.riskRewardRatio < MIN_RR) {
    veto = true;
    reasons.push(
      `VETO: R:R ${setup.riskRewardRatio.toFixed(2)} below floor ${MIN_RR.toFixed(2)}.`,
    );
  }

  if (setup.confidence < MIN_CONFIDENCE) {
    veto = true;
    reasons.push(
      `VETO: confidence ${setup.confidence} below floor ${MIN_CONFIDENCE}.`,
    );
  }

  if (!setup.qualityOk) {
    veto = true;
    reasons.push("VETO: setup quality low (trend not aligned or levels incomplete).");
  }

  if (veto) {
    return { approved: false, direction: "WAIT", reasoning: reasons };
  }

  return {
    approved: true,
    direction: setup.direction,
    reasoning: [
      `Approved ${setup.direction}: R:R ${setup.riskRewardRatio!.toFixed(2)} ≥ ${MIN_RR.toFixed(2)}, confidence ${setup.confidence} ≥ ${MIN_CONFIDENCE}.`,
    ],
  };
}
