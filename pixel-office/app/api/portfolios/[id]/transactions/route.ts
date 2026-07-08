// /api/portfolios/[id]/transactions — list (paged) + create.
// A create writes the ledger and recomputes the Holding cache atomically; the FX
// snapshot is taken from the body if provided, else the current live rate.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { requireOwnedPortfolio } from "@/lib/auth/tenancy";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { createTransactionSchema } from "@/lib/api/schemas";
import { serializeTransaction } from "@/lib/api/serialize";
import { recordTransaction } from "@/lib/portfolio/transactions";
import { createMarketDataService } from "@/lib/market-data";
import { valueHolding } from "@/lib/portfolio/valuation";
import { toHoldingViews } from "@/lib/portfolio/portfolio-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { userId } = await requireUser();
    await requireOwnedPortfolio(userId, id);

    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId") ?? undefined;
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") ?? 50), 1),
      200,
    );
    const cursor = url.searchParams.get("cursor") ?? undefined;

    const rows = await prisma.transaction.findMany({
      where: { portfolioId: id, ...(assetId ? { assetId } : {}) },
      include: { asset: { select: { symbol: true, assetType: true } } },
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      transactions: page.map((t) => serializeTransaction(t, t.asset)),
      nextCursor: hasMore ? page[page.length - 1].id : undefined,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { userId } = await requireUser();
    enforceRateLimit(userId, "write");
    const portfolio = await requireOwnedPortfolio(userId, id);

    const input = createTransactionSchema.parse(await request.json());
    const market = createMarketDataService();

    // FX snapshot: use the supplied rate, else snapshot the current live rate NOW
    // (this becomes the IMMUTABLE per-transaction rate).
    const fxRateUsdThb =
      input.fxRateUsdThb ?? (await market.getFxUsdThb()).rate.toString();

    const { transaction, asset, holding } = await recordTransaction({
      portfolioId: id,
      costBasisMethod: portfolio.costBasisMethod,
      assetSymbol: input.assetSymbol,
      assetType: input.assetType,
      assetName: input.assetName,
      type: input.type,
      quantity: input.quantity,
      executedPrice: input.executedPrice,
      currency: input.currency,
      fxRateUsdThb,
      fees: input.fees,
      executedAt: input.executedAt,
      source: input.source,
      externalId: input.externalId,
    });

    // Price the affected holding for an immediate HoldingView (never throws).
    const [quote, fx] = await Promise.all([
      market.getAssetPrice({
        id: asset.id,
        symbol: asset.symbol,
        assetType: asset.assetType,
      }),
      market.getFxUsdThb(),
    ]);
    const v = valueHolding(
      {
        assetSymbol: asset.symbol,
        assetType: asset.assetType,
        currency: asset.currency,
        quantity: holding.quantity,
        avgCostNative: holding.avgCostNative,
        avgCostThb: holding.avgCostThb,
        currentPrice: quote.price,
        priceSource: quote.source,
      },
      fx.rate,
    );
    const holdingView = toHoldingViews([v])[0];

    return NextResponse.json(
      { transaction: serializeTransaction(transaction, asset), holding: holdingView },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
