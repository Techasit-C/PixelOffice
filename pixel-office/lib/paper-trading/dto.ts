// Phase 4 API-boundary DTOs (design §15). Every Decimal crosses the boundary as a
// fixed-8dp string, never a JSON number. Nullability follows §15/§10 exactly:
// cashBalance/observedPeakEquity/dailyRealizedPnl are always-known persisted values;
// equity/totalExposure/observedDrawdownPct are null only when live valuation is
// incomplete; dailyLossPct is null only while today's baseline is null.
import type { PaperOrderSide, PaperOrderStatus } from "./types";

export interface AccountDTO {
  paperAccountId: string;
  generation: number;
  status: "ACTIVE" | "ARCHIVED";
  cashBalance: string;
  equity: string | null;
  equityAsOf: string | null;
  equityCompleteness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  totalExposure: string | null;
  observedPeakEquity: string;
  observedDrawdownPct: string | null;
  dailyRealizedPnl: string;
  dailyLossPct: string | null;
  emergencyStopActive: boolean;
  startingBalance: string;
}

export interface PositionDTO {
  symbol: string;
  quantity: string;
  costBasis: string;
  avgEntryPrice: string;
  currentMark: string | null;
  marketValue: string | null;
  unrealizedPnl: string | null;
  markAsOf: string | null;
  markStatus: "FRESH" | "UNAVAILABLE";
}

export interface OrderFillDTO {
  quantity: string;
  price: string;
  referenceMark: string;
  fee: string;
  notional: string;
  allocatedCostBasis: string | null;
  realizedPnl: string | null;
  executedAt: string;
}

export interface OrderResponseDTO {
  orderId: string;
  status: PaperOrderStatus;
  side: PaperOrderSide;
  symbol: string;
  requestedQuantity: string;
  reasonCode: string | null;
  reason: string | null;
  fill: OrderFillDTO | null;
  idempotent: boolean;
}

export interface RiskProfileDTO {
  maxRiskPerTradePct: string;
  maxPositionSizePct: string;
  maxTotalExposurePct: string;
  maxOpenPositions: number;
  dailyLossLimitPct: string;
  maxDrawdownPct: string;
  maxOrdersPerWindow: number;
  orderWindowMinutes: number;
  cooldownAfterLosses: number;
  cooldownMinutes: number;
}

export interface JournalEntryDTO {
  id: string;
  entryType: string;
  message: string;
  relatedOrderId: string | null;
  createdAt: string;
}

export interface AuditEntryDTO {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface EmergencyStopResponseDTO {
  paperAccountId: string;
  isActive: boolean;
  reason: string | null;
  activatedAt: string | null;
  activatedByUserId: string | null;
  resumedAt: string | null;
  resumedByUserId: string | null;
  idempotent: boolean;
}

export interface ResetResponseDTO {
  oldPaperAccountId: string;
  oldGeneration: number;
  newPaperAccountId: string;
  newGeneration: number;
  archivedAt: string;
  emergencyStopCarriedForward: boolean;
  idempotent: boolean;
}
