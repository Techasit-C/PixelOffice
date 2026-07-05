// /api/portfolios/[id]/valuation — live-valued totals + holdings with honest
// `source` ("live" | "partial" | "mock"). Follows the existing source-marker
// convention so degraded pricing is never presented as live.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { requireOwnedPortfolio } from "@/lib/auth/tenancy";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  buildValuation,
  toHoldingViews,
  toTotals,
} from "@/lib/portfolio/portfolio-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { userId } = await requireUser();
    // Provider-hitting read: cap per-user to protect upstream market-data quotas.
    enforceRateLimit(userId, "providerRead");
    const portfolio = await requireOwnedPortfolio(userId, id);

    const v = await buildValuation(portfolio);
    return NextResponse.json({
      asOf: v.asOf.toISOString(),
      fxRate: v.fxRate.toString(),
      fxSource: v.fxSource,
      totals: toTotals(v.totals),
      holdings: toHoldingViews(v.valuations),
      source: v.source,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
