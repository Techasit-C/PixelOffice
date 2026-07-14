export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { toErrorResponse } from "@/lib/api/errors";
import { getAccountForUser } from "@/lib/trading-bot/store";
import { toDecimalString } from "@/lib/trading-bot/serialize";
import type { PositionDTO } from "@/lib/trading-bot/dto";

export async function GET() {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "tradingBotRead");

    const account = getAccountForUser(userId);
    const positions: PositionDTO[] = [...account.positions.values()].map((position) => ({
      symbol: position.symbol,
      quantity: toDecimalString(position.quantity),
      avgEntryPrice: toDecimalString(position.avgEntryPrice),
      marketValue: null,
      unrealizedPnl: null,
      realizedPnl: toDecimalString(position.realizedPnl),
    }));
    return NextResponse.json({ positions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
