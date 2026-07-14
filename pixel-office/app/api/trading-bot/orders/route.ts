export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { toErrorResponse } from "@/lib/api/errors";
import { quantityInputSchema, parseQuantityInput, toDecimalString } from "@/lib/trading-bot/serialize";
import { signalEngineStrategy } from "@/lib/trading-bot/strategy";
import { stubRiskEngine } from "@/lib/trading-bot/risk-engine";
import { mockBroker } from "@/lib/trading-bot/mock-broker";
import { deriveBuyExecutionPrice } from "@/lib/trading-bot/pricing";
import {
  getAccountForUser,
  getIdempotentResult,
  storeIdempotentResult,
  withUserLock,
} from "@/lib/trading-bot/store";
import type { OrderResultDTO } from "@/lib/trading-bot/dto";
import type { OrderResult } from "@/lib/trading-bot/types";

const orderRequestSchema = z.object({
  signalId: z.string().min(1).max(64),
  observedGeneratedAt: z.string().min(1).max(64),
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

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "tradingBotWrite");

    const body = await request.json();
    const input = orderRequestSchema.parse(body);
    const requestedQuantity = parseQuantityInput(input.requestedQuantity);

    const result = await withUserLock(userId, async () => {
      const cached = getIdempotentResult(userId, input.idempotencyKey);
      if (cached) return { ...cached, idempotent: true };

      const strategyResult = await signalEngineStrategy.generateIntent(
        userId,
        input.signalId,
        input.observedGeneratedAt,
        requestedQuantity,
      );
      if (!strategyResult.ok) {
        const rejected: OrderResult = {
          orderId: randomUUID(),
          status: "REJECTED",
          reasonCode: strategyResult.code,
          reason: strategyResult.reason,
          side: "BUY",
          symbol: input.signalId.split(":")[0] ?? "",
          requestedQuantity,
          fill: null,
          idempotent: false,
        };
        storeIdempotentResult(userId, input.idempotencyKey, rejected);
        return rejected;
      }

      const account = getAccountForUser(userId);
      const verdict = stubRiskEngine.evaluate(strategyResult.intent, account);
      if (!verdict.approved) {
        const rejected: OrderResult = {
          orderId: randomUUID(),
          status: "REJECTED",
          reasonCode: verdict.code,
          reason: verdict.reason,
          side: "BUY",
          symbol: strategyResult.intent.symbol,
          requestedQuantity,
          fill: null,
          idempotent: false,
        };
        storeIdempotentResult(userId, input.idempotencyKey, rejected);
        return rejected;
      }

      const executionPrice = deriveBuyExecutionPrice(strategyResult.intent.sourceSignal!);
      const filled = await mockBroker.placeOrder({
        userId,
        idempotencyKey: input.idempotencyKey,
        intent: strategyResult.intent,
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
