import type { Prisma } from "@prisma/client";
import type { MockAccount, MockPosition, OrderResult, TradeIntent } from "./types";

export interface PlaceOrderRequest {
  userId: string;
  idempotencyKey: string;
  intent: TradeIntent; // already RiskEngine-approved by the caller
  executionPrice: Prisma.Decimal; // server-derived; the adapter never re-derives it
}

export interface BrokerAdapter {
  getAccount(userId: string): Promise<MockAccount>;
  placeOrder(request: PlaceOrderRequest): Promise<OrderResult>;
  getPositions(userId: string): Promise<MockPosition[]>;
}
