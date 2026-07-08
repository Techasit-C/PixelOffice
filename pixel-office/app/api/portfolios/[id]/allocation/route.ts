// /api/portfolios/[id]/allocation — allocation slices by asset or class (pct ~100).
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { requireOwnedPortfolio } from "@/lib/auth/tenancy";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { buildValuation, computeAllocation } from "@/lib/portfolio/portfolio-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { userId } = await requireUser();
    // Provider-hitting read: cap per-user to protect upstream market-data quotas.
    enforceRateLimit(userId, "providerRead");
    const portfolio = await requireOwnedPortfolio(userId, id);

    const by = new URL(request.url).searchParams.get("by") === "class"
      ? "class"
      : "asset";

    const v = await buildValuation(portfolio);
    const slices = computeAllocation(v.valuations, by).map((s) => ({
      key: s.key,
      label: s.label,
      marketValueBase: s.marketValueBase.toString(),
      pct: s.pct,
    }));

    return NextResponse.json({ asOf: v.asOf.toISOString(), by, slices, source: v.source });
  } catch (err) {
    return toErrorResponse(err);
  }
}
