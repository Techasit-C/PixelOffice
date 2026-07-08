// DCA milestone math — PURE. Progress of a portfolio's THB market value toward the
// ฿1,000,000 goal. If a portfolio has no explicit DcaMilestone rows, synthesize
// 25/50/75/100% checkpoints so the feature works with zero setup.
import { D, ratioPct, type Decimal, type DecimalInput } from "./money";

export interface MilestoneInput {
  label: string;
  targetThb: DecimalInput;
  achievedAt?: Date | null;
}

export interface MilestoneView {
  label: string;
  targetAmount: string; // Decimal serialized
  pct: number; // current / target, capped at 100 for display
  reached: boolean;
  reachedAt?: string; // ISO, when it was first crossed (persisted) — else undefined
}

export interface MilestoneSummary {
  target: string; // top target (max of milestones)
  currentValueBase: string; // current THB market value
  pct: number; // progress toward top target
  milestones: MilestoneView[];
}

const DEFAULT_FRACTIONS = [0.25, 0.5, 0.75, 1];

/** Synthesize default checkpoints as fractions of a top target (default ฿1,000,000). */
export function synthesizeMilestones(
  topTargetThb: DecimalInput = 1_000_000,
): MilestoneInput[] {
  const top = D(topTargetThb);
  return DEFAULT_FRACTIONS.map((f) => {
    const amt = top.times(f.toString());
    return { label: `฿${amt.toFixed(0)}`, targetThb: amt };
  });
}

/**
 * Compute milestone progress from current THB value. `reached` is true when
 * current >= target (live), regardless of a persisted achievedAt; achievedAt (if
 * present) is surfaced as reachedAt so the UI can show when it was first crossed.
 */
export function computeMilestones(
  currentValueBaseThb: DecimalInput,
  milestones: MilestoneInput[],
): MilestoneSummary {
  const current = D(currentValueBaseThb);
  const sorted = [...milestones].sort((a, b) =>
    D(a.targetThb).comparedTo(D(b.targetThb)),
  );
  const top: Decimal = sorted.length
    ? D(sorted[sorted.length - 1].targetThb)
    : D(0);

  const views: MilestoneView[] = sorted.map((m) => {
    const target = D(m.targetThb);
    const reached = current.greaterThanOrEqualTo(target) && target.greaterThan(0);
    return {
      label: m.label,
      targetAmount: target.toString(),
      pct: Math.min(100, ratioPct(current, target)),
      reached,
      reachedAt: m.achievedAt ? m.achievedAt.toISOString() : undefined,
    };
  });

  return {
    target: top.toString(),
    currentValueBase: current.toString(),
    pct: Math.min(100, ratioPct(current, top)),
    milestones: views,
  };
}
