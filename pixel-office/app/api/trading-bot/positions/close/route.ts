export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { toErrorResponse } from "@/lib/api/errors";
import { getCandles } from "@/lib/market-data/candles";
import { CANDLE_LIMIT, DEFAULT_TIMEFRAME, SYMBOL_WHITELIST } from "@/lib/trading-signals/config";
import { quantityInputSchema, parseQuantityInput, toDecimalString } from "@/lib/trading-bot/serialize";
import { checkCandleFreshness } from "@/lib/trading-bot/freshness";
import { stubRiskEngine } from "@/lib/trading-bot/risk-engine";
import { mockBroker } from "@/lib/trading-bot/mock-broker";
import {
  getAccountForUser,
  getIdempotentResult,
  storeIdempotentResult,
  withUserLock,
} from "@/lib/trading-bot/store";
import { defaultReason } from "@/lib/trading-bot/errors";
import type { OrderResultDTO } from "@/lib/trading-bot/dto";
import type { OrderResult, TradeIntent } from "@/lib/trading-bot/types";

const closeRequestSchema = z.object({
  symbol: z.string().min(1).max(20),
  requestedQuantity: quantityInputSchema,
  idempotencyKey: z.string().min(1).max(128),
});

function toDTO(result: OrderResult): OrderResultDTO {
  return {
    orderId: result.orderId,
    status: result.status,
    reasonCode: result.reasonCode,
    reason: result.reason,
    side: result.side,
    symbol: result.symbol,
    requestedQuantity: toDecimalString(result.requestedQuantity),
    fillPrice: result.fill ? toDecimalString(result.fill.price) : null,
    fee: result.fill ? toDecimalString(result.fill.fee) : null,
    notional: result.fill ? toDecimalString(result.fill.notional) : null,
    realizedPnl: result.fill?.realizedPnl ? toDecimalString(result.fill.realizedPnl) : null,
    executedAt: result.fill?.executedAt ?? null,
    idempotent: result.idempotent,
  };
}

function reject(
  symbol: string,
  requestedQuantity: Prisma.Decimal,
  reasonCode: NonNullable<OrderResult["reasonCode"]>,
  reason?: string,
): OrderResult {
  return {
    orderId: randomUUID(),
    status: "REJECTED",
    reasonCode,
    reason: reason ?? defaultReason(reasonCode),
    side: "SELL",
    symbol,
    requestedQuantity,
    fill: null,
    idempotent: false,
  };
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "tradingBotWrite");

    const body = await request.json();
    const input = closeRequestSchema.parse(body);
    const requestedQuantity = parseQuantityInput(input.requestedQuantity);

    const result = await withUserLock(userId, async () => {
      const cached = getIdempotentResult(userId, input.idempotencyKey);
      if (cached) return { ...cached, idempotent: true };

      // No signalId anywhere in this request or pipeline — closing a position
      // is unconditionally independent of any signal, including SHORT.
      const intent: TradeIntent = {
        userId,
        symbol: input.symbol,
        timeframe: DEFAULT_TIMEFRAME as "4h",
        side: "SELL",
        requestedQuantity,
        createdAt: new Date().toISOString(),
      };

      const account = getAccountForUser(userId);
      const verdict = stubRiskEngine.evaluate(intent, account);
      if (!verdict.approved) {
        const rejected = reject(input.symbol, requestedQuantity, verdict.code, verdict.reason);
        storeIdempotentResult(userId, input.idempotencyKey, rejected);
        return rejected;
      }

      // `symbol` is a selector into the user's own tracked positions, not
      // client-trusted pricing data — verdict.approved above already proves a
      // position exists for it, and positions only ever exist for symbols the
      // whitelist recognizes (BUY is gated by SignalEngineStrategy).
      const ticker = SYMBOL_WHITELIST[input.symbol];
      if (!ticker) {
        const rejected = reject(input.symbol, requestedQuantity, "NO_OPEN_POSITION");
        storeIdempotentResult(userId, input.idempotencyKey, rejected);
        return rejected;
      }

      const series = await getCandles(ticker, DEFAULT_TIMEFRAME, CANDLE_LIMIT);
      const freshness = checkCandleFreshness(series.candles, DEFAULT_TIMEFRAME, Date.now());
      if (!freshness.ok) {
        const rejected = reject(input.symbol, requestedQuantity, freshness.code, freshness.reason);
        storeIdempotentResult(userId, input.idempotencyKey, rejected);
        return rejected;
      }

      const lastCandle = series.candles[series.candles.length - 1];
      const executionPrice = new Prisma.Decimal(lastCandle.close);

      const filled = await mockBroker.placeOrder({
        userId,
        idempotencyKey: input.idempotencyKey,
        intent,
        executionPrice,
      });
      storeIdempotentResult(userId, input.idempotencyKey, filled);
      return filled;
    });

    return NextResponse.json(toDTO(result));
  } catch (err) {
    return toErrorResponse(err);
  }
}
