// In-memory, per-user, long-only paper-broker. Never fetches market data or a
// price itself — PlaceOrderRequest.executionPrice is always caller-supplied.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getAccountForUser } from "./store";
import { estimateOrderCost } from "./pricing";
import { MOCK_FEE_RATE } from "./config";
import { defaultReason } from "./errors";
import type { BrokerAdapter, PlaceOrderRequest } from "./broker-types";
import type { Fill, MockPosition, OrderResult } from "./types";

function rounded(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}

function rejected(
  orderId: string,
  side: "BUY" | "SELL",
  symbol: string,
  requestedQuantity: Prisma.Decimal,
  reasonCode: NonNullable<OrderResult["reasonCode"]>,
): OrderResult {
  return {
    orderId,
    status: "REJECTED",
    reasonCode,
    reason: defaultReason(reasonCode),
    side,
    symbol,
    requestedQuantity,
    fill: null,
    idempotent: false,
  };
}

export class MockBroker implements BrokerAdapter {
  async getAccount(userId: string) {
    return getAccountForUser(userId);
  }

  async getPositions(userId: string) {
    return [...getAccountForUser(userId).positions.values()];
  }

  async placeOrder(request: PlaceOrderRequest): Promise<OrderResult> {
    const { intent, executionPrice, userId } = request;
    const account = getAccountForUser(userId);
    const orderId = randomUUID();
    const executedAt = new Date().toISOString();

    if (intent.side === "BUY") {
      const notional = rounded(executionPrice.times(intent.requestedQuantity));
      const fee = rounded(notional.times(MOCK_FEE_RATE));
      const totalCost = rounded(estimateOrderCost(notional));
      if (totalCost.greaterThan(account.cashBalance)) {
        return rejected(orderId, "BUY", intent.symbol, intent.requestedQuantity, "INSUFFICIENT_FUNDS");
      }

      account.cashBalance = rounded(account.cashBalance.minus(totalCost));

      const existing = account.positions.get(intent.symbol);
      let position: MockPosition;
      if (existing) {
        const newQuantity = existing.quantity.plus(intent.requestedQuantity);
        const newAvgEntryPrice = rounded(
          existing.quantity
            .times(existing.avgEntryPrice)
            .plus(intent.requestedQuantity.times(executionPrice))
            .dividedBy(newQuantity),
        );
        position = {
          symbol: intent.symbol,
          quantity: newQuantity,
          avgEntryPrice: newAvgEntryPrice,
          realizedPnl: existing.realizedPnl,
        };
      } else {
        position = {
          symbol: intent.symbol,
          quantity: intent.requestedQuantity,
          avgEntryPrice: rounded(executionPrice),
          realizedPnl: new Prisma.Decimal(0),
        };
      }
      account.positions.set(intent.symbol, position);

      const fill: Fill = {
        orderId,
        userId,
        symbol: intent.symbol,
        side: "BUY",
        quantity: intent.requestedQuantity,
        price: rounded(executionPrice),
        fee,
        notional,
        realizedPnl: null,
        executedAt,
      };
      return {
        orderId,
        status: "FILLED",
        reasonCode: null,
        reason: null,
        side: "BUY",
        symbol: intent.symbol,
        requestedQuantity: intent.requestedQuantity,
        fill,
        idempotent: false,
      };
    }

    // SELL — long-only: may only reduce or fully close an existing position.
    const position = account.positions.get(intent.symbol);
    if (!position) {
      return rejected(orderId, "SELL", intent.symbol, intent.requestedQuantity, "NO_OPEN_POSITION");
    }
    if (intent.requestedQuantity.greaterThan(position.quantity)) {
      return rejected(orderId, "SELL", intent.symbol, intent.requestedQuantity, "INSUFFICIENT_POSITION");
    }

    const proceeds = rounded(executionPrice.times(intent.requestedQuantity));
    const fee = rounded(proceeds.times(MOCK_FEE_RATE));
    const netProceeds = rounded(proceeds.minus(fee));
    const realizedPnl = rounded(
      executionPrice.minus(position.avgEntryPrice).times(intent.requestedQuantity).minus(fee),
    );

    account.cashBalance = rounded(account.cashBalance.plus(netProceeds));
    const remainingQuantity = position.quantity.minus(intent.requestedQuantity);
    if (remainingQuantity.isZero()) {
      account.positions.delete(intent.symbol);
    } else {
      account.positions.set(intent.symbol, {
        symbol: intent.symbol,
        quantity: remainingQuantity,
        avgEntryPrice: position.avgEntryPrice, // unchanged on partial close
        realizedPnl: rounded(position.realizedPnl.plus(realizedPnl)),
      });
    }

    const fill: Fill = {
      orderId,
      userId,
      symbol: intent.symbol,
      side: "SELL",
      quantity: intent.requestedQuantity,
      price: rounded(executionPrice),
      fee,
      notional: proceeds,
      realizedPnl,
      executedAt,
    };
    return {
      orderId,
      status: "FILLED",
      reasonCode: null,
      reason: null,
      side: "SELL",
      symbol: intent.symbol,
      requestedQuantity: intent.requestedQuantity,
      fill,
      idempotent: false,
    };
  }
}

export const mockBroker = new MockBroker();
