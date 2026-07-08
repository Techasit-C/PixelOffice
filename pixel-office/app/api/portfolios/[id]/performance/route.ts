// /api/portfolios/[id]/performance — historical portfolio-value time series (CR-004).
//
// GET  -> read the snapshot series for the TradingView Lightweight Charts widget:
//         { series: [{ time: <unix seconds>, value: "<THB string>" }], source }.
//         Optional ?from=&to=&limit= narrow the range.
// POST -> manually capture TODAY's snapshot (idempotent). This is the MANUAL trigger
//         standing in for the daily cron seam documented in snapshot-service.ts —
//         no scheduler exists yet, so this lets an operator/admin populate history.
//
// Prisma needs the Node runtime. Auth-scoped: 404 on any ownership mismatch. Both
// verbs hit the provider layer (GET indirectly via honesty markers, POST via
// buildValuation), so both are rate-limited as provider reads.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { requireOwnedPortfolio } from "@/lib/auth/tenancy";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { performanceQuerySchema } from "@/lib/api/schemas";
import {
  capturePortfolioSnapshot,
  loadPerformanceSeries,
} from "@/lib/portfolio/snapshot-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { userId } = await requireUser();
    // Cap provider-adjacent reads per user (protects upstream quotas / this endpoint).
    enforceRateLimit(userId, "providerRead");
    const portfolio = await requireOwnedPortfolio(userId, id);

    const url = new URL(request.url);
    const query = performanceQuerySchema.parse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const result = await loadPerformanceSeries(portfolio.id, {
      from: query.from,
      to: query.to,
      limit: query.limit,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { userId } = await requireUser();
    // Provider-hitting write path (values the whole portfolio): rate-limit it.
    enforceRateLimit(userId, "providerRead");
    const portfolio = await requireOwnedPortfolio(userId, id);

    const { capturedAt } = await capturePortfolioSnapshot(portfolio);
    return NextResponse.json(
      { ok: true, capturedAt: capturedAt.toISOString() },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
