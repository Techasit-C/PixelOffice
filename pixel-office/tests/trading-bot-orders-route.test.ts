import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({ requireUser: vi.fn() }));

import { requireUser } from "@/lib/auth/current-user";
import { Unauthorized } from "@/lib/api/errors";
import { POST } from "@/app/api/trading-bot/orders/route";
import { signalEngineStrategy } from "@/lib/trading-bot/strategy";
import { mockBroker } from "@/lib/trading-bot/mock-broker";
import { __resetRateLimiters } from "@/lib/api/rate-limit";
import { __resetTradingBotStore, getAccountForUser } from "@/lib/trading-bot/store";
import { Prisma } from "@prisma/client";

beforeEach(() => {
  __resetTradingBotStore();
  __resetRateLimiters();
  vi.mocked(requireUser).mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/trading-bot/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(idempotencyKey = "key-1") {
  return {
    signalId: "BTC/USDT:4h",
    observedGeneratedAt: new Date().toISOString(),
    requestedQuantity: "0.5",
    idempotencyKey,
  };
}

describe("POST /api/trading-bot/orders — authorization", () => {
  it("returns 401 when requireUser rejects, independent of any middleware", async () => {
    // requireUser()'s real contract: no valid session -> throws Unauthorized (never a bare Error).
    vi.mocked(requireUser).mockRejectedValue(new Unauthorized());
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/trading-bot/orders — pipeline", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", clerkUserId: "clerk-1" });
  });

  it("returns FILLED with every monetary/quantity field as a string, via a real Strategy fill", async () => {
    const account = getAccountForUser("user-1");
    account.cashBalance = new Prisma.Decimal("10000");
    vi.spyOn(signalEngineStrategy, "generateIntent").mockResolvedValue({
      ok: true,
      intent: {
        userId: "user-1",
        symbol: "BTC/USDT",
        timeframe: "4h",
        side: "BUY",
        requestedQuantity: new Prisma.Decimal("0.5"),
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
      },
    });

    const res = await POST(req(validBody()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("FILLED");
    for (const field of ["requestedQuantity", "fillPrice", "fee", "notional"]) {
      expect(typeof json[field]).toBe("string");
    }
  });

  it("a RiskEngine rejection never reaches MockBroker.placeOrder", async () => {
    vi.spyOn(signalEngineStrategy, "generateIntent").mockResolvedValue({
      ok: true,
      intent: {
        userId: "user-1",
        symbol: "BTC/USDT",
        timeframe: "4h",
        side: "BUY",
        requestedQuantity: new Prisma.Decimal("0.5"),
        sourceSignal: {
          direction: "LONG",
          entryZone: { low: 1_000_000, high: 1_000_000 },
          stopLoss: 900_000,
          takeProfit: [],
          riskRewardRatio: 2,
          confidence: 70,
          generatedAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      },
    });
    const placeOrderSpy = vi.spyOn(mockBroker, "placeOrder");
    const res = await POST(req(validBody()));
    const json = await res.json();
    expect(json.status).toBe("REJECTED");
    expect(json.reasonCode).toBe("INSUFFICIENT_FUNDS");
    expect(placeOrderSpy).not.toHaveBeenCalled();
  });

  it("idempotency: a duplicate key returns the identical result without a second fill", async () => {
    const account = getAccountForUser("user-1");
    account.cashBalance = new Prisma.Decimal("10000");
    vi.spyOn(signalEngineStrategy, "generateIntent").mockResolvedValue({
      ok: true,
      intent: {
        userId: "user-1",
        symbol: "BTC/USDT",
        timeframe: "4h",
        side: "BUY",
        requestedQuantity: new Prisma.Decimal("0.5"),
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
      },
    });

    const first = await (await POST(req(validBody("dup-key")))).json();
    const cashAfterFirst = getAccountForUser("user-1").cashBalance.toString();
    const second = await (await POST(req(validBody("dup-key")))).json();
    const cashAfterSecond = getAccountForUser("user-1").cashBalance.toString();

    expect(second.orderId).toBe(first.orderId);
    expect(second.idempotent).toBe(true);
    expect(cashAfterSecond).toBe(cashAfterFirst); // no second deduction
  });

  it("per-user isolation: two users with the same idempotency key do not interact", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ userId: "user-1", clerkUserId: "c1" });
    vi.spyOn(signalEngineStrategy, "generateIntent").mockResolvedValue({
      ok: false,
      code: "NON_ACTIONABLE_SIGNAL",
      reason: "wait",
    });
    const first = await (await POST(req(validBody("shared-key")))).json();

    vi.mocked(requireUser).mockResolvedValueOnce({ userId: "user-2", clerkUserId: "c2" });
    const second = await (await POST(req(validBody("shared-key")))).json();

    expect(first.orderId).not.toBe(second.orderId);
    expect(second.idempotent).toBe(false); // fresh for user-2, not user-1's cached result
  });

  it("400 on a malformed body (bad quantity)", async () => {
    const res = await POST(req({ ...validBody(), requestedQuantity: "not-a-number" }));
    expect(res.status).toBe(400);
  });
});
