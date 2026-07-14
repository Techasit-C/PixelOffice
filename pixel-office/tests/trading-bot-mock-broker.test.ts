import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { mockBroker } from "@/lib/trading-bot/mock-broker";
import { getAccountForUser, __resetTradingBotStore } from "@/lib/trading-bot/store";
import type { TradeIntent } from "@/lib/trading-bot/types";

beforeEach(() => __resetTradingBotStore());

function buyIntent(userId: string, quantity: string): TradeIntent {
  return {
    userId,
    symbol: "BTC/USDT",
    timeframe: "4h",
    side: "BUY",
    requestedQuantity: new Prisma.Decimal(quantity),
    sourceSignal: {
      direction: "LONG",
      entryZone: { low: 100, high: 100 },
      stopLoss: 90,
      takeProfit: [],
      riskRewardRatio: 2,
      confidence: 70,
      generatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };
}

function sellIntent(userId: string, quantity: string): TradeIntent {
  return {
    userId,
    symbol: "BTC/USDT",
    timeframe: "4h",
    side: "SELL",
    requestedQuantity: new Prisma.Decimal(quantity),
    createdAt: new Date().toISOString(),
  };
}

describe("MockBroker BUY", () => {
  it("computes notional/fee and deducts total cost from cash", async () => {
    const result = await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k1",
      intent: buyIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("100"),
    });
    expect(result.status).toBe("FILLED");
    expect(result.fill?.notional.toString()).toBe("100");
    expect(result.fill?.fee.toString()).toBe("0.1"); // 100 * 0.001
    const account = getAccountForUser("user-1");
    expect(account.cashBalance.toString()).toBe("9899.9"); // 10000 - 100.1
  });

  it("updates weighted average entry price across repeat buys", async () => {
    await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k1",
      intent: buyIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("100"),
    });
    await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k2",
      intent: buyIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("200"),
    });
    const account = getAccountForUser("user-1");
    const position = account.positions.get("BTC/USDT")!;
    expect(position.quantity.toString()).toBe("2");
    expect(position.avgEntryPrice.toString()).toBe("150"); // (1*100 + 1*200) / 2
  });

  it("rejects INSUFFICIENT_FUNDS when notional + fee exceeds cash (not raw quantity vs equity)", async () => {
    const result = await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k1",
      intent: buyIntent("user-1", "1000"), // 1000 * 100 = 100,000 notional, way over 10,000 cash
      executionPrice: new Prisma.Decimal("100"),
    });
    expect(result.status).toBe("REJECTED");
    expect(result.reasonCode).toBe("INSUFFICIENT_FUNDS");
    const account = getAccountForUser("user-1");
    expect(account.cashBalance.toString()).toBe("10000"); // unchanged
  });
});

describe("MockBroker SELL", () => {
  async function openLongPosition(userId: string, quantity: string, price: string) {
    await mockBroker.placeOrder({
      userId,
      idempotencyKey: `open-${userId}`,
      intent: buyIntent(userId, quantity),
      executionPrice: new Prisma.Decimal(price),
    });
  }

  it("reduces the position and computes realized P&L including the fee", async () => {
    await openLongPosition("user-1", "2", "100");
    const result = await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "close-1",
      intent: sellIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("150"),
    });
    expect(result.status).toBe("FILLED");
    // (150 - 100) * 1 - fee(150*0.001=0.15) = 49.85
    expect(result.fill?.realizedPnl?.toString()).toBe("49.85");
    const account = getAccountForUser("user-1");
    const position = account.positions.get("BTC/USDT")!;
    expect(position.quantity.toString()).toBe("1");
    expect(position.avgEntryPrice.toString()).toBe("100"); // unchanged on partial close
  });

  it("removes the position entirely on a full close", async () => {
    await openLongPosition("user-1", "1", "100");
    await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "close-1",
      intent: sellIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("110"),
    });
    const account = getAccountForUser("user-1");
    expect(account.positions.has("BTC/USDT")).toBe(false);
  });

  it("rejects NO_OPEN_POSITION when the user holds none for the symbol (no naked SELL)", async () => {
    const result = await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k1",
      intent: sellIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("100"),
    });
    expect(result.status).toBe("REJECTED");
    expect(result.reasonCode).toBe("NO_OPEN_POSITION");
  });

  it("rejects INSUFFICIENT_POSITION when quantity exceeds held quantity", async () => {
    await openLongPosition("user-1", "1", "100");
    const result = await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k1",
      intent: sellIntent("user-1", "2"),
      executionPrice: new Prisma.Decimal("100"),
    });
    expect(result.status).toBe("REJECTED");
    expect(result.reasonCode).toBe("INSUFFICIENT_POSITION");
    const account = getAccountForUser("user-1");
    expect(account.positions.get("BTC/USDT")!.quantity.toString()).toBe("1"); // unchanged
  });
});
