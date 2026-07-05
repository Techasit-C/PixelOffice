// /api/portfolios/[id] — read (portfolio + valued holdings), update, delete.
// 404 (not 403) when the id is not owned by the caller.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { requireOwnedPortfolio } from "@/lib/auth/tenancy";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { updatePortfolioSchema } from "@/lib/api/schemas";
import { serializePortfolio } from "@/lib/api/serialize";
import {
  buildValuation,
  toHoldingViews,
} from "@/lib/portfolio/portfolio-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { userId } = await requireUser();
    // Provider-hitting read: cap per-user to protect upstream market-data quotas.
    enforceRateLimit(userId, "providerRead");
    const portfolio = await requireOwnedPortfolio(userId, id);

    const valuation = await buildValuation(portfolio);
    return NextResponse.json({
      portfolio: serializePortfolio(portfolio),
      holdings: toHoldingViews(valuation.valuations),
      source: valuation.source,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { userId } = await requireUser();
    enforceRateLimit(userId, "write");
    await requireOwnedPortfolio(userId, id);

    const input = updatePortfolioSchema.parse(await request.json());
    const portfolio = await prisma.portfolio.update({
      where: { id },
      data: input,
    });
    return NextResponse.json({ portfolio: serializePortfolio(portfolio) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { userId } = await requireUser();
    enforceRateLimit(userId, "write");
    await requireOwnedPortfolio(userId, id);

    // Cascade in the schema removes holdings/transactions/milestones.
    await prisma.portfolio.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
