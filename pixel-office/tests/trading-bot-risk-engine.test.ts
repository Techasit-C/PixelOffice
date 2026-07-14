import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { stubRiskEngine } from "@/lib/trading-bot/risk-engine";
import type { MockAccount, TradeIntent } from "@/lib/trading-bot/types";

function account(cash: string, positions: MockAccount["positions"] = new Map()): MockAccount {
  return {
    userId: "user-1",
    cashBalance: new Prisma.Decimal(cash),
    startingBalance: new Prisma.Decimal("10000"),
    positions,
  };
}

function buyIntent(quantity: string, stopLoss = 90): TradeIntent {
  return {
    userId: "user-1",
    symbol: "BTC/USDT",
    timeframe: "4h",
    side: "BUY",
    requestedQuantity: new Prisma.Decimal(quantity),
    sourceSignal: {
      direction: "LONG",
      entryZone: { low: 100, high: 100 },
      stopLoss,
      takeProfit: [],
      riskRewardRatio: 2,
      confidence: 70,
      generatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };
}

function sellIntent(quantity: string): TradeIntent {
  return {
    userId: "user-1",
    symbol: "BTC/USDT",
    timeframe: "4h",
    side: "SELL",
    requestedQuantity: new Prisma.Decimal(quantity),
    createdAt: new Date().toISOString(),
  };
}

describe("StubRiskEngine — BUY", () => {
  it("approves a well-formed, affordable BUY", () => {
    const verdict = stubRiskEngine.evaluate(buyIntent("1"), account("10000"));
    expect(verdict.approved).toBe(true);
  });

  it("rejects MISSING_STOP_LOSS when there is no source signal", () => {
    const intentWithNoSignal: TradeIntent = {
      userId: "user-1",
      symbol: "BTC/USDT",
      timeframe: "4h",
      side: "BUY",
      requestedQuantity: new Prisma.Decimal("1"),
      // sourceSignal deliberately omitted — must be rejected, not defaulted.
      createdAt: new Date().toISOString(),
    };
    const verdict = stubRiskEngine.evaluate(intentWithNoSignal, account("10000"));
    expect(verdict.approved).toBe(false);
    if (!verdict.approved) expect(verdict.code).toBe("MISSING_STOP_LOSS");
  });

  it("rejects INSUFFICIENT_FUNDS on total cost (notional + fee), not raw quantity vs equity", () => {
    // entry midpoint = 100, quantity 1000 -> notional 100,000, way over 10,000 cash
    const verdict = stubRiskEngine.evaluate(buyIntent("1000"), account("10000"));
    expect(verdict.approved).toBe(false);
    if (!verdict.approved) expect(verdict.code).toBe("INSUFFICIENT_FUNDS");
  });
});

describe("StubRiskEngine — SELL", () => {
  it("approves a SELL within the held position", () => {
    const positions = new Map([["BTC/USDT", {
      symbol: "BTC/USDT",
      quantity: new Prisma.Decimal("2"),
      avgEntryPrice: new Prisma.Decimal("100"),
      realizedPnl: new Prisma.Decimal("0"),
    }]]);
    const verdict = stubRiskEngine.evaluate(sellIntent("1"), account("10000", positions));
    expect(verdict.approved).toBe(true);
  });

  it("rejects NO_OPEN_POSITION when the user holds none", () => {
    const verdict = stubRiskEngine.evaluate(sellIntent("1"), account("10000"));
    expect(verdict.approved).toBe(false);
    if (!verdict.approved) expect(verdict.code).toBe("NO_OPEN_POSITION");
  });

  it("rejects INSUFFICIENT_POSITION when quantity exceeds held quantity", () => {
    const positions = new Map([["BTC/USDT", {
      symbol: "BTC/USDT",
      quantity: new Prisma.Decimal("1"),
      avgEntryPrice: new Prisma.Decimal("100"),
      realizedPnl: new Prisma.Decimal("0"),
    }]]);
    const verdict = stubRiskEngine.evaluate(sellIntent("2"), account("10000", positions));
    expect(verdict.approved).toBe(false);
    if (!verdict.approved) expect(verdict.code).toBe("INSUFFICIENT_POSITION");
  });
});

describe("StubRiskEngine — quantity format", () => {
  it("rejects a zero quantity defensively", () => {
    const verdict = stubRiskEngine.evaluate(buyIntent("0"), account("10000"));
    expect(verdict.approved).toBe(false);
    if (!verdict.approved) expect(verdict.code).toBe("INVALID_QUANTITY");
  });
});
