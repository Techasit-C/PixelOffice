// /api/portfolios/[id]/milestones — DCA progress toward ฿1,000,000. Uses explicit
// DcaMilestone rows if present, else synthesizes 25/50/75/100% checkpoints.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { requireOwnedPortfolio } from "@/lib/auth/tenancy";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { buildValuation } from "@/lib/portfolio/portfolio-service";
import { loadMilestoneInputs } from "@/lib/portfolio/milestone-service";
import { computeMilestones } from "@/lib/portfolio/milestones";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { userId } = await requireUser();
    // Provider-hitting read: cap per-user to protect upstream market-data quotas.
    enforceRateLimit(userId, "providerRead");
    const portfolio = await requireOwnedPortfolio(userId, id);

    const v = await buildValuation(portfolio);
    const milestones = await loadMilestoneInputs(portfolio);
    const summary = computeMilestones(v.totals.marketValueBase, milestones);

    return NextResponse.json({ ...summary, source: v.source });
  } catch (err) {
    return toErrorResponse(err);
  }
}
