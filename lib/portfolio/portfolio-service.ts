// Portfolio read orchestration: load Holdings -> price each via MarketDataService
// (cache/snapshot/mock fallback) -> run the PURE valuation engine -> serialize.
// The valuation/allocation/milestones routes all build on buildValuation().
import { prisma } from "@/lib/db";
import type { OwnedPortfolio } from "@/lib/auth/tenancy";
import { createMarketDataService, type MarketDataService } from "@/lib/market-data";
import {
  aggregateSource,
  computeAllocation,
  computeTotals,
  valueHolding,
  type HoldingValuation,
  type ValuationSource,
} from "./valuation";
import type { Decimal } from "./money";
import type { HoldingView, ValuationTotals } from "@/types/portfolio";

export interface BuiltValuation {
  asOf: Date;
  fxRate: Decimal;
  fxSource: string;
  valuations: HoldingValuation[]; // Decimal-typed, for allocation/milestone reuse
  totals: ReturnType<typeof computeTotals>;
  source: ValuationSource;
}

/**
 * Price + value every holding in a portfolio. Never throws on provider failure.
 *
 * F-06: takes a PRE-AUTHORIZED OwnedPortfolio (proof an ownership check ran), not a
 * raw id, so a portfolio-scoped query can never run here without an upstream
 * userId-scoped gate. The branded type makes bypass a compile error.
 */
export async function buildValuation(
  portfolio: OwnedPortfolio,
  market: MarketDataService = createMarketDataService(),
): Promise<BuiltValuation> {
  const portfolioId = portfolio.id;
  const holdings = await prisma.holding.findMany({
    where: { portfolioId },
    include: { asset: true },
  });

  const fx = await market.getFxUsdThb();

  const valuations: HoldingValuation[] = [];
  for (const h of holdings) {
    const quote = await market.getAssetPrice({
      id: h.assetId,
      symbol: h.asset.symbol,
      assetType: h.asset.assetType,
    });
    valuations.push(
      valueHolding(
        {
          assetSymbol: h.asset.symbol,
          assetType: h.asset.assetType,
          currency: h.asset.currency,
          quantity: h.quantity,
          avgCostNative: h.avgCostNative,
          avgCostThb: h.avgCostThb,
          currentPrice: quote.price,
          priceSource: quote.source,
        },
        fx.rate,
      ),
    );
  }

  return {
    asOf: new Date(),
    fxRate: fx.rate,
    fxSource: fx.source,
    valuations,
    totals: computeTotals(valuations),
    source: aggregateSource(valuations.map((v) => v.priceSource)),
  };
}

/** Serialize valued holdings to wire DTOs (all money as strings). */
export function toHoldingViews(valuations: HoldingValuation[]): HoldingView[] {
  return valuations.map((v) => ({
    assetSymbol: v.assetSymbol,
    assetClass: v.assetType,
    quantity: v.quantity.toString(),
    avgCostPerUnit: v.avgCostNative.toString(),
    totalCostBasis: v.totalCostBasisNative.toString(),
    currentPrice: v.currentPrice.toString(),
    currentValueNative: v.currentValueNative.toString(),
    currentValueBase: v.currentValueBase.toString(),
    unrealizedPnlNative: v.unrealizedPnlNative.toString(),
    unrealizedPnlBase: v.unrealizedPnlBase.toString(),
    unrealizedPnlPct: v.unrealizedPnlPct,
    priceSource: v.priceSource,
  }));
}

export function toTotals(t: BuiltValuation["totals"]): ValuationTotals {
  return {
    costBasisBase: t.costBasisBase.toString(),
    marketValueBase: t.marketValueBase.toString(),
    unrealizedPnlBase: t.unrealizedPnlBase.toString(),
    unrealizedPnlPct: t.unrealizedPnlPct,
    costBasisUsd: t.costBasisUsd.toString(),
    marketValueUsd: t.marketValueUsd.toString(),
  };
}

export { computeAllocation };
