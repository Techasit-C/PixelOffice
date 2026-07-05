// Tenant isolation choke point. EVERY portfolio-scoped read/write goes through a
// helper here that ALWAYS takes userId, so an unscoped query is impossible to write
// by accident. Ownership mismatch -> NotFound (404), never 403 — do not leak that
// another user's portfolio exists.
import type { Portfolio, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { NotFound } from "@/lib/api/errors";

type Db = PrismaClient | Prisma.TransactionClient;

// Defense-in-depth (CR-003 F-06): a branded Portfolio that is proof-by-type that an
// ownership (userId-scoped) check has already run. Portfolio-scoped compute helpers
// (buildValuation, loadMilestoneInputs, capturePortfolioSnapshot) accept ONLY this
// type, so it is a compile error to feed them a raw id/portfolio that skipped the
// ownership gate. The brand is a phantom field — it exists only in the type system.
declare const OWNERSHIP_CHECKED: unique symbol;
export type OwnedPortfolio = Portfolio & { readonly [OWNERSHIP_CHECKED]: true };

/**
 * Brand a portfolio row the SYSTEM loaded without a per-user check — legitimate ONLY
 * for internal, unauthenticated contexts that iterate all portfolios (e.g. the daily
 * snapshot cron). NEVER call this in a request handler; use requireOwnedPortfolio.
 */
export function asSystemOwnedPortfolio(p: Portfolio): OwnedPortfolio {
  return p as OwnedPortfolio;
}

/** Fetch a portfolio ONLY if it belongs to userId; else 404. */
export async function requireOwnedPortfolio(
  userId: string,
  portfolioId: string,
  db: Db = defaultPrisma,
): Promise<OwnedPortfolio> {
  const portfolio = await db.portfolio.findFirst({
    where: { id: portfolioId, userId },
  });
  if (!portfolio) throw new NotFound("Portfolio not found");
  return portfolio as OwnedPortfolio;
}

/** Fetch a transaction ONLY if it belongs to userId's portfolio; else 404. */
export async function requireOwnedTransaction(
  userId: string,
  portfolioId: string,
  txId: string,
  db: Db = defaultPrisma,
) {
  const transaction = await db.transaction.findFirst({
    where: { id: txId, portfolioId, portfolio: { userId } },
  });
  if (!transaction) throw new NotFound("Transaction not found");
  return transaction;
}

/** List the caller's portfolios — scoped by userId, always. */
export async function listOwnedPortfolios(
  userId: string,
  db: Db = defaultPrisma,
): Promise<OwnedPortfolio[]> {
  // Every row is userId-scoped by the WHERE, so all are ownership-verified.
  const rows = await db.portfolio.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows as OwnedPortfolio[];
}
