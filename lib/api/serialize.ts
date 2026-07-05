// Prisma-row -> DTO serializers. Every Decimal becomes a string here — the single
// place money crosses the wire boundary.
import type { Asset, Portfolio, Transaction } from "@prisma/client";
import type { PortfolioDTO, TransactionDTO } from "@/types/portfolio";

export function serializePortfolio(p: Portfolio): PortfolioDTO {
  return {
    id: p.id,
    name: p.name,
    baseCurrency: p.baseCurrency,
    costBasisMethod: p.costBasisMethod,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function serializeTransaction(
  t: Transaction,
  asset: Pick<Asset, "symbol" | "assetType">,
): TransactionDTO {
  return {
    id: t.id,
    portfolioId: t.portfolioId,
    assetId: t.assetId,
    assetSymbol: asset.symbol,
    assetType: asset.assetType,
    type: t.type,
    quantity: t.quantity.toString(),
    executedPrice: t.executedPrice.toString(),
    currency: t.currency,
    fxRateUsdThb: t.fxRateUsdThb.toString(),
    fees: t.fees ? t.fees.toString() : null,
    executedAt: t.executedAt.toISOString(),
    source: t.source,
    externalId: t.externalId,
    createdAt: t.createdAt.toISOString(),
  };
}
