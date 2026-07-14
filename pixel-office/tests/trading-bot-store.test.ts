import { describe, it, expect, beforeEach } from "vitest";
import {
  getAccountForUser,
  getIdempotentResult,
  storeIdempotentResult,
  withUserLock,
  __resetTradingBotStore,
} from "@/lib/trading-bot/store";
import type { OrderResult } from "@/lib/trading-bot/types";
import { Prisma } from "@prisma/client";

beforeEach(() => __resetTradingBotStore());

function fakeResult(orderId: string): OrderResult {
  return {
    orderId,
    status: "FILLED",
    reasonCode: null,
    reason: null,
    side: "BUY",
    symbol: "BTC/USDT",
    requestedQuantity: new Prisma.Decimal("1"),
    fill: null,
    idempotent: false,
  };
}

describe("getAccountForUser", () => {
  it("creates a fresh account at the starting balance on first access", () => {
    const account = getAccountForUser("user-1");
    expect(account.cashBalance.toString()).toBe("10000");
    expect(account.startingBalance.toString()).toBe("10000");
    expect(account.positions.size).toBe(0);
  });

  it("returns the SAME object on repeat access (so mutations persist)", () => {
    const a = getAccountForUser("user-1");
    a.cashBalance = a.cashBalance.minus(1);
    const b = getAccountForUser("user-1");
    expect(b.cashBalance.toString()).toBe("9999");
  });

  it("isolates accounts per user", () => {
    const a = getAccountForUser("user-1");
    a.cashBalance = a.cashBalance.minus(500);
    const b = getAccountForUser("user-2");
    expect(b.cashBalance.toString()).toBe("10000");
  });
});

describe("idempotency index", () => {
  it("is empty until a result is stored, then returns it", () => {
    expect(getIdempotentResult("user-1", "key-1")).toBeUndefined();
    storeIdempotentResult("user-1", "key-1", fakeResult("order-1"));
    expect(getIdempotentResult("user-1", "key-1")?.orderId).toBe("order-1");
  });

  it("scopes idempotency keys per user — the same literal key does not collide", () => {
    storeIdempotentResult("user-1", "shared-key", fakeResult("order-A"));
    storeIdempotentResult("user-2", "shared-key", fakeResult("order-B"));
    expect(getIdempotentResult("user-1", "shared-key")?.orderId).toBe("order-A");
    expect(getIdempotentResult("user-2", "shared-key")?.orderId).toBe("order-B");
  });
});

describe("withUserLock", () => {
  it("serializes calls for the same user in submission order", async () => {
    const order: number[] = [];
    const first = withUserLock("user-1", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const second = withUserLock("user-1", async () => {
      order.push(2);
    });
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it("does not serialize calls for different users", async () => {
    const order: string[] = [];
    const a = withUserLock("user-1", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("a");
    });
    const b = withUserLock("user-2", async () => {
      order.push("b");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["b", "a"]); // b finishes first, unblocked by a's lock
  });

  it("a failed call does not wedge the lock for the next call", async () => {
    await expect(
      withUserLock("user-1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const result = await withUserLock("user-1", async () => "ok");
    expect(result).toBe("ok");
  });
});
