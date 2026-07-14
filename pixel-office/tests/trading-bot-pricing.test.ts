import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { estimateOrderCost, deriveBuyExecutionPrice } from "@/lib/trading-bot/pricing";
import type { SourceSignal } from "@/lib/trading-bot/types";

describe("estimateOrderCost", () => {
  it("adds notional + fee at the default 0.1% rate", () => {
    const notional = new Prisma.Decimal("1000");
    const cost = estimateOrderCost(notional);
    expect(cost.toString()).toBe("1001"); // 1000 + 1000*0.001
  });

  it("accepts an explicit fee rate override", () => {
    const notional = new Prisma.Decimal("100");
    const cost = estimateOrderCost(notional, new Prisma.Decimal("0.01"));
    expect(cost.toString()).toBe("101");
  });
});

describe("deriveBuyExecutionPrice", () => {
  it("is the midpoint of the entry zone", () => {
    const sourceSignal: SourceSignal = {
      direction: "LONG",
      entryZone: { low: 100, high: 110 },
      stopLoss: 95,
      takeProfit: [],
      riskRewardRatio: 2,
      confidence: 70,
      generatedAt: new Date().toISOString(),
    };
    expect(deriveBuyExecutionPrice(sourceSignal).toString()).toBe("105");
  });
});
