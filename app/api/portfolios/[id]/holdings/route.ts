// /api/portfolios/[id]/holdings — valued holdings for the portfolio.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { requireOwnedPortfolio } from "@/lib/auth/tenancy";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { buildValuation, toHoldingViews } from "@/lib/portfolio/portfolio-service";

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
      holdings: toHoldingViews(valuation.valuations),
      source: valuation.source,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
