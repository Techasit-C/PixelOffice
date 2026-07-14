export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/current-user";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { toErrorResponse } from "@/lib/api/errors";
import { getCandles } from "@/lib/market-data/candles";
import { CANDLE_LIMIT, DEFAULT_TIMEFRAME, SYMBOL_WHITELIST } from "@/lib/trading-signals/config";
import { getAccountForUser } from "@/lib/trading-bot/store";
import { toDecimalString } from "@/lib/trading-bot/serialize";
import type { AccountDTO, PositionDTO } from "@/lib/trading-bot/dto";

export async function GET() {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "tradingBotRead");

    const account = getAccountForUser(userId);
    const positions: PositionDTO[] = await Promise.all(
      [...account.positions.values()].map(async (position) => {
        let marketValue: Prisma.Decimal | null = null;
        const ticker = SYMBOL_WHITELIST[position.symbol];
        if (ticker) {
          const series = await getCandles(ticker, DEFAULT_TIMEFRAME, CANDLE_LIMIT);
          const last = series.candles[series.candles.length - 1];
          if (last) marketValue = new Prisma.Decimal(last.close).times(position.quantity);
        }
        const unrealizedPnl = marketValue
          ? marketValue.minus(position.avgEntryPrice.times(position.quantity))
          : null;
        return {
          symbol: position.symbol,
          quantity: toDecimalString(position.quantity),
          avgEntryPrice: toDecimalString(position.avgEntryPrice),
          marketValue: marketValue ? toDecimalString(marketValue) : null,
          unrealizedPnl: unrealizedPnl ? toDecimalString(unrealizedPnl) : null,
          realizedPnl: toDecimalString(position.realizedPnl),
        };
      }),
    );

    const equity = positions.reduce(
      (sum, p) => (p.marketValue ? sum.plus(p.marketValue) : sum),
      account.cashBalance,
    );

    const dto: AccountDTO = {
      currency: "USDT",
      cashBalance: toDecimalString(account.cashBalance),
      equity: toDecimalString(equity),
      startingBalance: toDecimalString(account.startingBalance),
      positions,
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(dto);
  } catch (err) {
    return toErrorResponse(err);
  }
}
