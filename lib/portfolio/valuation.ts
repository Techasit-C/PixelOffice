// Valuation engine — PURE functions over {holdings, current prices, fx}. No DB, no
// network, no HTTP. This is the critical correctness surface and is unit-tested in
// isolation.
//
// Money rule: THB market value uses TODAY's FX (a live valuation), while THB cost
// basis uses avgCostThb derived from each transaction's IMMUTABLE fx snapshot.
// Cost basis is never re-valued at today's rate.
import type { AssetType } from "@prisma/client";
import { D, ZERO, ratioPct, sum, type Decimal, type DecimalInput } from "./money";
import type { PriceSource } from "@/lib/market-data";

export interface HoldingValuationInput {
  assetSymbol: string;
  assetType: AssetType;
  currency: string; // native currency of price/avgCostNative
  quantity: DecimalInput;
  avgCostNative: DecimalInput;
  avgCostThb: DecimalInput;
  currentPrice: DecimalInput; // native currency, from MarketDataService
  priceSource: PriceSource;
  /** Seam for dividend tax drag (US ETF 15%, REIT ~30%). Optional in Phase 1. */
  dividendTaxRatePct?: DecimalInput;
}

export interface HoldingValuation {
  assetSymbol: string;
  assetType: AssetType;
  currency: string;
  quantity: Decimal;
  avgCostNative: Decimal;
  totalCostBasisNative: Decimal;
  totalCostBasisThb: Decimal;
  currentPrice: Decimal;
  currentValueNative: Decimal;
  currentValueBase: Decimal; // THB
  unrealizedPnlNative: Decimal;
  unrealizedPnlBase: Decimal; // THB
  unrealizedPnlPct: number;
  priceSource: PriceSource;
}

export interface PortfolioTotals {
  costBasisBase: Decimal; // THB
  marketValueBase: Decimal; // THB
  unrealizedPnlBase: Decimal; // THB
  unrealizedPnlPct: number;
  costBasisUsd: Decimal;
  marketValueUsd: Decimal;
}

export type ValuationSource = "live" | "partial" | "mock";

/** USD->THB conversion respecting the holding's native currency. */
function toBase(native: Decimal, currency: string, fxUsdThb: Decimal): Decimal {
  if (currency === "THB") return native;
  // Everything else in scope (US ETF/stock, crypto) quotes in USD.
  return native.times(fxUsdThb);
}

/** Value a single holding. Pure. */
export function valueHolding(
  input: HoldingValuationInput,
  fxUsdThb: DecimalInput,
): HoldingValuation {
  const fx = D(fxUsdThb);
  const qty = D(input.quantity);
  const avgNative = D(input.avgCostNative);
  const avgThb = D(input.avgCostThb);
  const price = D(input.currentPrice);

  const totalCostBasisNative = avgNative.times(qty);
  const totalCostBasisThb = avgThb.times(qty);
  const currentValueNative = price.times(qty);
  const currentValueBase = toBase(currentValueNative, input.currency, fx);

  const unrealizedPnlNative = currentValueNative.minus(totalCostBasisNative);
  const unrealizedPnlBase = currentValueBase.minus(totalCostBasisThb);

  return {
    assetSymbol: input.assetSymbol,
    assetType: input.assetType,
    currency: input.currency,
    quantity: qty,
    avgCostNative: avgNative,
    totalCostBasisNative,
    totalCostBasisThb,
    currentPrice: price,
    currentValueNative,
    currentValueBase,
    unrealizedPnlNative,
    unrealizedPnlBase,
    unrealizedPnlPct: ratioPct(unrealizedPnlNative, totalCostBasisNative),
    priceSource: input.priceSource,
  };
}

/** Aggregate portfolio totals across valued holdings. Pure. */
export function computeTotals(holdings: HoldingValuation[]): PortfolioTotals {
  const costBasisBase = sum(holdings.map((h) => h.totalCostBasisThb));
  const marketValueBase = sum(holdings.map((h) => h.currentValueBase));
  const unrealizedPnlBase = marketValueBase.minus(costBasisBase);

  // USD totals only meaningful for USD-native holdings (all in-scope assets).
  const usd = holdings.filter((h) => h.currency === "USD");
  const costBasisUsd = sum(usd.map((h) => h.totalCostBasisNative));
  const marketValueUsd = sum(usd.map((h) => h.currentValueNative));

  return {
    costBasisBase,
    marketValueBase,
    unrealizedPnlBase,
    unrealizedPnlPct: ratioPct(unrealizedPnlBase, costBasisBase),
    costBasisUsd,
    marketValueUsd,
  };
}

/** Honest overall provenance from the per-holding price sources. */
export function aggregateSource(sources: PriceSource[]): ValuationSource {
  if (sources.length === 0) return "live";
  const isLive = (s: PriceSource) => s === "finnhub" || s === "coingecko";
  if (sources.every(isLive)) return "live";
  if (sources.every((s) => !isLive(s))) return "mock";
  return "partial";
}

export interface AllocationSlice {
  key: string;
  label: string;
  marketValueBase: Decimal;
  pct: number;
}

/** Allocation by asset symbol or by asset class. pct sums ~100. Pure. */
export function computeAllocation(
  holdings: HoldingValuation[],
  by: "asset" | "class",
): AllocationSlice[] {
  const total = sum(holdings.map((h) => h.currentValueBase));
  const buckets = new Map<string, Decimal>();
  for (const h of holdings) {
    const key = by === "class" ? h.assetType : h.assetSymbol;
    buckets.set(key, (buckets.get(key) ?? ZERO).plus(h.currentValueBase));
  }
  return [...buckets.entries()]
    .map(([key, value]) => ({
      key,
      label: key,
      marketValueBase: value,
      pct: ratioPct(value, total),
    }))
    .sort((a, b) => b.marketValueBase.comparedTo(a.marketValueBase));
}

/**
 * Dividend tax-drag seam. Net cash a dividend actually delivers after withholding
 * (US ETF 15% w/ W-8BEN, REIT ~30%). Kept here so yield/income reporting stays
 * truthful when DIVIDEND transactions are surfaced. Pure.
 */
export function netDividend(gross: DecimalInput, taxRatePct: DecimalInput): Decimal {
  const g = D(gross);
  const rate = D(taxRatePct);
  const withheld = g.times(rate).div(100);
  return g.minus(withheld);
}
