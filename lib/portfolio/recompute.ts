// Holding recompute — the SINGLE writer of the derived Holding cache.
//
// MUST run inside the same DB transaction as the Transaction write (see the
// transactions route) or the cache drifts from the source-of-truth ledger. Replays
// the whole per-asset transaction log through the cost-basis strategy and upserts
// the Holding row.
import { Prisma } from "@prisma/client";
import type { CostBasisMethod } from "@prisma/client";
import { getCostBasisStrategy, type CostBasisTx } from "./cost-basis";

/** Prisma transaction client (the `tx` handed to prisma.$transaction callbacks). */
type Tx = Prisma.TransactionClient;

/**
 * Recompute and upsert the Holding for (portfolioId, assetId) from its full
 * transaction log. Returns the persisted Holding row.
 */
export async function recomputeHolding(
  tx: Tx,
  portfolioId: string,
  assetId: string,
  method: CostBasisMethod = "AVERAGE_COST",
) {
  const rows = await tx.transaction.findMany({
    where: { portfolioId, assetId },
    orderBy: { executedAt: "asc" },
  });

  const strategy = getCostBasisStrategy(method);
  const txs: CostBasisTx[] = rows.map((r) => ({
    type: r.type,
    quantity: r.quantity,
    executedPrice: r.executedPrice,
    currency: r.currency,
    fxRateUsdThb: r.fxRateUsdThb,
    fees: r.fees,
    executedAt: r.executedAt,
  }));

  const c = strategy.compute(txs);

  return tx.holding.upsert({
    where: { portfolioId_assetId: { portfolioId, assetId } },
    create: {
      portfolioId,
      assetId,
      quantity: c.quantity,
      avgCostNative: c.avgCostNative,
      avgCostThb: c.avgCostThb,
    },
    update: {
      quantity: c.quantity,
      avgCostNative: c.avgCostNative,
      avgCostThb: c.avgCostThb,
    },
  });
}
