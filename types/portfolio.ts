// Shared portfolio DTO types. Money is ALWAYS a string on the wire (Decimal is
// serialized at the API boundary; the UI formats strings, never does money math).
import type { AssetType, TransactionType } from "@prisma/client";
import type { PriceSource } from "@/lib/market-data";
import type { ValuationSource } from "@/lib/portfolio/valuation";

export interface PortfolioDTO {
  id: string;
  name: string;
  baseCurrency: string;
  costBasisMethod: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionDTO {
  id: string;
  portfolioId: string;
  assetId: string;
  assetSymbol: string;
  assetType: AssetType;
  type: TransactionType;
  quantity: string;
  executedPrice: string;
  currency: string;
  fxRateUsdThb: string;
  fees: string | null;
  executedAt: string;
  source: string | null;
  externalId: string | null;
  createdAt: string;
}

export interface HoldingView {
  assetSymbol: string;
  assetClass: AssetType;
  quantity: string;
  avgCostPerUnit: string; // native currency
  totalCostBasis: string; // native currency
  currentPrice: string;
  currentValueNative: string;
  currentValueBase: string; // THB
  unrealizedPnlNative: string;
  unrealizedPnlBase: string; // THB
  unrealizedPnlPct: number;
  priceSource: PriceSource;
}

export interface ValuationTotals {
  costBasisBase: string;
  marketValueBase: string;
  unrealizedPnlBase: string;
  unrealizedPnlPct: number;
  costBasisUsd: string;
  marketValueUsd: string;
}

export interface ValuationResponse {
  asOf: string;
  fxRate: string;
  totals: ValuationTotals;
  holdings: HoldingView[];
  source: ValuationSource;
}

export interface AllocationSliceDTO {
  key: string;
  label: string;
  marketValueBase: string;
  pct: number;
}
