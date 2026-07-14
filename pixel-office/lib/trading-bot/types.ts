// Server-only domain types for the Phase 1 mock trading pipeline. All money and
// quantity fields use Prisma.Decimal — never a JS number.
import type { Prisma } from "@prisma/client";

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "FILLED" | "REJECTED";

export type RejectCode =
  | "UNRECOGNIZED_SIGNAL"
  | "NON_ACTIONABLE_SIGNAL"
  | "UNSUPPORTED_SHORT"
  | "STALE_SIGNAL" // the signal INSTANCE the user acted on is too old
  | "STALE_CANDLE_DATA" // the underlying market data is too old, independent of signal age
  | "INVALID_QUANTITY"
  | "MISSING_STOP_LOSS"
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_POSITION"
  | "NO_OPEN_POSITION";

export interface SourceSignal {
  direction: "LONG";
  entryZone: { low: number; high: number };
  stopLoss: number;
  takeProfit: { price: number; label: string }[];
  riskRewardRatio: number | null;
  confidence: number;
  generatedAt: string;
}

export interface TradeIntent {
  userId: string;
  symbol: string;
  timeframe: "4h";
  side: OrderSide;
  requestedQuantity: Prisma.Decimal;
  /** Present for BUY (signal-derived); absent for SELL (position-derived). */
  sourceSignal?: SourceSignal;
  createdAt: string;
}

export interface MockPosition {
  symbol: string;
  quantity: Prisma.Decimal; // always > 0 while present; zeroed positions are removed
  avgEntryPrice: Prisma.Decimal;
  realizedPnl: Prisma.Decimal; // cumulative, across all closes of this symbol
}

export interface MockAccount {
  userId: string;
  cashBalance: Prisma.Decimal;
  startingBalance: Prisma.Decimal;
  positions: Map<string, MockPosition>; // key: symbol
}

export interface Fill {
  orderId: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal;
  fee: Prisma.Decimal;
  notional: Prisma.Decimal;
  realizedPnl: Prisma.Decimal | null; // set for SELL only
  executedAt: string;
}

export interface OrderResult {
  orderId: string;
  status: OrderStatus;
  reasonCode: RejectCode | null;
  reason: string | null;
  side: OrderSide;
  symbol: string;
  requestedQuantity: Prisma.Decimal;
  fill: Fill | null;
  idempotent: boolean; // true when served from the idempotency cache
}
