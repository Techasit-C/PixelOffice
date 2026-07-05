// /api/portfolios/[id]/transactions/[txId] — update or delete a single ledger row.
// Both recompute the affected Holding atomically. 404 on any ownership mismatch.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import {
  requireOwnedPortfolio,
  requireOwnedTransaction,
} from "@/lib/auth/tenancy";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { updateTransactionSchema } from "@/lib/api/schemas";
import { serializeTransaction } from "@/lib/api/serialize";
import { recomputeHolding } from "@/lib/portfolio/recompute";
import { deleteTransactionAndRecompute } from "@/lib/portfolio/transactions";
import { buildValuation, toHoldingViews } from "@/lib/portfolio/portfolio-service";

type Ctx = { params: Promise<{ id: string; txId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id, txId } = await params;
    const { userId } = await requireUser();
    enforceRateLimit(userId, "write");
    const portfolio = await requireOwnedPortfolio(userId, id);
    const existing = await requireOwnedTransaction(userId, id, txId);

    const input = updateTransactionSchema.parse(await request.json());

    // Mutable fields only. Asset identity/symbol is not editable here (would move
    // the row to a different asset); create a new transaction for that instead.
    const data: Prisma.TransactionUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.quantity !== undefined)
      data.quantity = new Prisma.Decimal(input.quantity);
    if (input.executedPrice !== undefined)
      data.executedPrice = new Prisma.Decimal(input.executedPrice);
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.fxRateUsdThb !== undefined)
      data.fxRateUsdThb = new Prisma.Decimal(input.fxRateUsdThb);
    if (input.fees !== undefined)
      data.fees = input.fees ? new Prisma.Decimal(input.fees) : null;
    if (input.executedAt !== undefined) data.executedAt = input.executedAt;

    const { transaction, holding } = await prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id: txId },
        data,
        include: { asset: { select: { symbol: true, assetType: true } } },
      });
      const h = await recomputeHolding(
        tx,
        id,
        existing.assetId,
        portfolio.costBasisMethod,
      );
      return { transaction: updated, holding: h };
    });

    // Re-price for a fresh HoldingView.
    const valuation = await buildValuation(portfolio);
    const holdingView = toHoldingViews(
      valuation.valuations.filter((v) => v.assetSymbol === transaction.asset.symbol),
    )[0];

    return NextResponse.json({
      transaction: serializeTransaction(transaction, transaction.asset),
      holding: holdingView ?? null,
      // holding row is recomputed even if it has no market price yet
      holdingQuantity: holding.quantity.toString(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id, txId } = await params;
    const { userId } = await requireUser();
    enforceRateLimit(userId, "write");
    const portfolio = await requireOwnedPortfolio(userId, id);
    const existing = await requireOwnedTransaction(userId, id, txId);

    const { holding } = await deleteTransactionAndRecompute(
      id,
      txId,
      existing.assetId,
      portfolio.costBasisMethod,
    );

    return NextResponse.json({ ok: true, holdingQuantity: holding.quantity.toString() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
