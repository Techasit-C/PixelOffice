// Public JSON contract types. STRING for every monetary/quantity field. Never
// imports @prisma/client — safe to import from client components.

export interface PositionDTO {
  symbol: string;
  quantity: string;
  avgEntryPrice: string;
  marketValue: string | null; // null if a fresh quote could not be fetched
  unrealizedPnl: string | null;
  realizedPnl: string;
}

export interface AccountDTO {
  currency: "USDT";
  cashBalance: string;
  equity: string; // cashBalance + sum(position market value)
  startingBalance: string;
  positions: PositionDTO[];
  generatedAt: string;
}

export interface OrderResultDTO {
  orderId: string;
  status: "FILLED" | "REJECTED";
  reasonCode: string | null;
  reason: string | null;
  side: "BUY" | "SELL";
  symbol: string;
  requestedQuantity: string;
  fillPrice: string | null;
  fee: string | null;
  notional: string | null;
  realizedPnl: string | null;
  executedAt: string | null;
  idempotent: boolean;
}
