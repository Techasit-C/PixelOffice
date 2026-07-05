// /api/cron/snapshot — daily "value EVERY portfolio" job (the [CRON SEAM] from
// snapshot-service.ts, now realized). Triggered by Vercel Cron (vercel.json:
// `0 22 * * *`), which sends `Authorization: Bearer <CRON_SECRET>`.
//
// This is a SYSTEM job that iterates ALL tenants — the one legitimate caller of
// asSystemOwnedPortfolio() (never reachable from a user request handler). Auth is a
// fail-closed shared-secret check, NOT Clerk: with no logged-in user, CRON_SECRET is
// the only gate, so an unset secret must reject rather than run open.
//
// Prisma needs the Node runtime. CRON_SECRET is read at REQUEST time (below), never at
// build/module load, so a keyless build still succeeds.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { asSystemOwnedPortfolio } from "@/lib/auth/tenancy";
import { capturePortfolioSnapshot } from "@/lib/portfolio/snapshot-service";
import { toErrorResponse } from "@/lib/api/errors";
import {
  authorizeCron,
  runSnapshotBatch,
  type CaptureOutcome,
} from "@/lib/cron/snapshot-batch";

export async function POST(request: Request) {
  // Fail-closed auth. Generic 401 on any failure (unset secret OR mismatch) — do not
  // reveal which, and never echo the secret.
  if (!authorizeCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // System-wide read (no userId scope) — correct here and why asSystemOwnedPortfolio
    // exists. _count.holdings lets us skip empty portfolios without a per-row query.
    const portfolios = await prisma.portfolio.findMany({
      include: { _count: { select: { holdings: true } } },
    });

    const summary = await runSnapshotBatch(portfolios, async (portfolio) => {
      if (portfolio._count.holdings === 0) return "skipped";
      await capturePortfolioSnapshot(asSystemOwnedPortfolio(portfolio));
      return "captured" satisfies CaptureOutcome;
    });

    return NextResponse.json(summary);
  } catch (err) {
    // Only reached if the top-level DB read (or something outside the per-portfolio
    // try/catch) fails — mapped to a generic, secret-redacted response.
    return toErrorResponse(err);
  }
}
