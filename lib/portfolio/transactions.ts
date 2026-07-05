// Transaction write service. The ledger insert and the derived-Holding recompute
// happen in ONE prisma.$transaction so the cache can never drift from the source of
// truth. Asset reference rows are resolved/created here (shared, unscoped).
import { Prisma } from "@prisma/client";
import type { AssetType, CostBasisMethod, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recomputeHolding } from "./recompute";

export interface RecordTransactionArgs {
  portfolioId: string;
  costBasisMethod: CostBasisMethod;
  assetSymbol: string;
  assetType: AssetType;
  assetName?: string;
  type: TransactionType;
  quantity: string;
  executedPrice: string;
  currency: string;
  fxRateUsdThb: string; // already resolved (body value or live snapshot)
  fees?: string;
  executedAt: Date;
  source?: string;
  externalId?: string;
}

/** Resolve a shared Asset row by (symbol, assetType), creating it on first use. */
export async function resolveOrCreateAsset(
  tx: Prisma.TransactionClient,
  symbol: string,
  assetType: AssetType,
  currency: string,
  name?: string,
) {
  const sym = symbol.toUpperCase();
  return tx.asset.upsert({
    where: { symbol_assetType: { symbol: sym, assetType } },
    create: { symbol: sym, assetType, currency, name: name ?? sym },
    update: {},
  });
}

/** Insert a transaction and recompute its asset's Holding, atomically. */
export async function recordTransaction(args: RecordTransactionArgs) {
  return prisma.$transaction(async (tx) => {
    const asset = await resolveOrCreateAsset(
      tx,
      args.assetSymbol,
      args.assetType,
      args.currency,
      args.assetName,
    );

    const transaction = await tx.transaction.create({
      data: {
        portfolioId: args.portfolioId,
        assetId: asset.id,
        type: args.type,
        quantity: new Prisma.Decimal(args.quantity),
        executedPrice: new Prisma.Decimal(args.executedPrice),
        currency: args.currency,
        fxRateUsdThb: new Prisma.Decimal(args.fxRateUsdThb),
        fees: args.fees ? new Prisma.Decimal(args.fees) : null,
        executedAt: args.executedAt,
        source: args.source ?? "manual",
        externalId: args.externalId ?? null,
      },
    });

    // Recompute throws InsufficientQuantityError on an over-sell -> whole txn rolls
    // back, so the ledger never records a sell that leaves a negative position.
    const holding = await recomputeHolding(
      tx,
      args.portfolioId,
      asset.id,
      args.costBasisMethod,
    );

    return { transaction, asset, holding };
  });
}

/** Delete a transaction and recompute the affected Holding, atomically. */
export async function deleteTransactionAndRecompute(
  portfolioId: string,
  txId: string,
  assetId: string,
  costBasisMethod: CostBasisMethod,
) {
  return prisma.$transaction(async (tx) => {
    await tx.transaction.delete({ where: { id: txId } });
    const holding = await recomputeHolding(tx, portfolioId, assetId, costBasisMethod);
    return { holding };
  });
}
