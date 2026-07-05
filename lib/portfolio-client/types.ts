// UI-facing response types for the (frozen) portfolio API.
//
// Shared DTOs are IMPORTED from the backend's own type modules rather than
// redefined. The only shapes declared here are the ones the backend builds inline
// in a route handler and does not export (the list summary, paged/allocation/
// milestone envelopes) — mirrored precisely against the handler source.
import type {
  TransactionDTO,
  HoldingView,
  ValuationTotals,
  AllocationSliceDTO,
} from "@/types/portfolio";
import type { MilestoneSummary } from "@/lib/portfolio/milestones";
import type { ValuationSource } from "@/lib/portfolio/valuation";
import type {
  PerformanceSeries,
  SeriesPoint,
} from "@/lib/portfolio/snapshot-service";

export type { TransactionDTO, HoldingView, AllocationSliceDTO };
export type { PerformanceSeries, SeriesPoint };
export type TransactionType = TransactionDTO["type"];
export type AssetType = TransactionDTO["assetType"];

// GET /api/portfolios (app/api/portfolios/route.ts -> `summaries`)
export interface PortfolioSummary {
  id: string;
  name: string;
  baseCurrency: string;
  currentValueBase: string;
  unrealizedPnlBase: string;
  dcaTargetAmount: string;
  dcaPct: number;
  source: ValuationSource;
}
export interface PortfolioListResponse {
  portfolios: PortfolioSummary[];
}

// GET /api/portfolios/[id]/valuation
export interface ValuationEnvelope {
  asOf: string;
  fxRate: string;
  fxSource: string;
  totals: ValuationTotals;
  holdings: HoldingView[];
  source: ValuationSource;
}

// GET /api/portfolios/[id]/allocation
export interface AllocationEnvelope {
  asOf: string;
  by: "asset" | "class";
  slices: AllocationSliceDTO[];
  source: ValuationSource;
}

// GET /api/portfolios/[id]/milestones
export type MilestonesEnvelope = MilestoneSummary & { source: ValuationSource };

// GET /api/portfolios/[id]/performance — historical value time-series for the chart.
// The handler returns snapshot-service's PerformanceSeries verbatim; mirror it here.
export type PerformanceEnvelope = PerformanceSeries;

// GET /api/portfolios/[id]/transactions
export interface TransactionsEnvelope {
  transactions: TransactionDTO[];
  nextCursor?: string;
}

// POST /api/portfolios/[id]/transactions — body (Zod: createTransactionSchema).
export interface CreateTransactionBody {
  assetSymbol: string;
  assetType: AssetType;
  type: TransactionType;
  quantity: string;
  executedPrice: string;
  currency: string;
  fxRateUsdThb?: string;
  fees?: string;
  executedAt: string; // ISO
  assetName?: string;
}
export type UpdateTransactionBody = Partial<CreateTransactionBody>;

// POST /api/portfolios — body (Zod: createPortfolioSchema).
export interface CreatePortfolioBody {
  name: string;
  baseCurrency?: string;
}

export type { ValuationSource };
