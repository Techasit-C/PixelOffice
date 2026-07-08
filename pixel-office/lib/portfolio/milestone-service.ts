// Milestone data access: load explicit DcaMilestone rows for a portfolio, or fall
// back to synthesized 25/50/75/100% checkpoints of ฿1,000,000 so the feature works
// with zero setup (per the DCA mandate).
import { prisma } from "@/lib/db";
import type { OwnedPortfolio } from "@/lib/auth/tenancy";
import { synthesizeMilestones, type MilestoneInput } from "./milestones";

const DEFAULT_TOP_TARGET_THB = 1_000_000;

/**
 * Milestone inputs for a portfolio — DB rows if present, else synthesized.
 * F-06: accepts a pre-authorized OwnedPortfolio, never a raw id.
 */
export async function loadMilestoneInputs(
  portfolio: OwnedPortfolio,
): Promise<MilestoneInput[]> {
  const rows = await prisma.dcaMilestone.findMany({
    where: { portfolioId: portfolio.id },
    orderBy: { targetThb: "asc" },
  });

  if (rows.length === 0) {
    return synthesizeMilestones(DEFAULT_TOP_TARGET_THB);
  }

  return rows.map((r) => ({
    label: `฿${r.targetThb.toFixed(0)}`,
    targetThb: r.targetThb,
    achievedAt: r.achievedAt,
  }));
}
