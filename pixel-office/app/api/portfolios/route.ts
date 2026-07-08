// /api/portfolios — list the caller's portfolios (with value summary) + create one.
// Prisma needs the Node runtime (cannot run on Edge with the standard client).
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { listOwnedPortfolios } from "@/lib/auth/tenancy";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { createPortfolioSchema } from "@/lib/api/schemas";
import { serializePortfolio } from "@/lib/api/serialize";
import { buildValuation } from "@/lib/portfolio/portfolio-service";
import { loadMilestoneInputs } from "@/lib/portfolio/milestone-service";
import { computeMilestones } from "@/lib/portfolio/milestones";

export async function GET() {
  try {
    const { userId } = await requireUser();
    const portfolios = await listOwnedPortfolios(userId);

    const summaries = await Promise.all(
      portfolios.map(async (p) => {
        const v = await buildValuation(p);
        const milestones = await loadMilestoneInputs(p);
        const ms = computeMilestones(v.totals.marketValueBase, milestones);
        return {
          id: p.id,
          name: p.name,
          baseCurrency: p.baseCurrency,
          currentValueBase: v.totals.marketValueBase.toString(),
          unrealizedPnlBase: v.totals.unrealizedPnlBase.toString(),
          dcaTargetAmount: ms.target,
          dcaPct: ms.pct,
          source: v.source,
        };
      }),
    );

    return NextResponse.json({ portfolios: summaries });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "write");
    const body = await request.json();
    const input = createPortfolioSchema.parse(body);

    const portfolio = await prisma.portfolio.create({
      data: {
        userId,
        name: input.name,
        baseCurrency: input.baseCurrency ?? "THB",
        costBasisMethod: input.costBasisMethod ?? "AVERAGE_COST",
      },
    });

    return NextResponse.json(
      { portfolio: serializePortfolio(portfolio) },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
