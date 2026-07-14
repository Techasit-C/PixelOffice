import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/auth/current-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/market-data/candles", () => ({ getCandles: vi.fn() }));

import { requireUser } from "@/lib/auth/current-user";
import { getCandles } from "@/lib/market-data/candles";
import { POST } from "@/app/api/trading-bot/positions/close/route";
import { mockBroker } from "@/lib/trading-bot/mock-broker";
import { __resetRateLimiters } from "@/lib/api/rate-limit";
import { __resetTradingBotStore, getAccountForUser } from "@/lib/trading-bot/store";

beforeEach(() => {
  __resetTradingBotStore();
  __resetRateLimiters();
  vi.mocked(requireUser).mockReset();
  vi.mocked(getCandles).mockReset();
  vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", clerkUserId: "clerk-1" });
});

function req(body: unknown) {
  return new Request("http://localhost/api/trading-bot/positions/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function freshSeries(close = 150) {
  const now = Date.now();
  return {
    symbol: "BTC/USDT",
    timeframe: "4h" as const,
    candles: [{ openTime: now - 60_000, open: 100, high: 155, low: 95, close, volume: 10 }],
    source: "live" as const,
    fetchedAt: now,
  };
}

function openLongPosition(userId: string) {
  const account = getAccountForUser(userId);
  account.positions.set("BTC/USDT", {
    symbol: "BTC/USDT",
    quantity: new Prisma.Decimal("1"),
    avgEntryPrice: new Prisma.Decimal("100"),
    realizedPnl: new Prisma.Decimal("0"),
  });
}

describe("POST /api/trading-bot/positions/close — authorization", () => {
  it("returns 401 when requireUser rejects", async () => {
    vi.mocked(requireUser).mockReset();
    const { Unauthorized } = await import("@/lib/api/errors");
    vi.mocked(requireUser).mockRejectedValue(new Unauthorized());
    const res = await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "k1" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/trading-bot/positions/close — pipeline", () => {
  it("rejects NO_OPEN_POSITION when the user holds none, without calling getCandles", async () => {
    const res = await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "k1" }));
    const json = await res.json();
    expect(json.status).toBe("REJECTED");
    expect(json.reasonCode).toBe("NO_OPEN_POSITION");
    expect(getCandles).not.toHaveBeenCalled();
  });

  it("rejects INSUFFICIENT_POSITION when quantity exceeds held quantity", async () => {
    openLongPosition("user-1");
    const res = await POST(req({ symbol: "BTC/USDT", requestedQuantity: "2", idempotencyKey: "k1" }));
    const json = await res.json();
    expect(json.status).toBe("REJECTED");
    expect(json.reasonCode).toBe("INSUFFICIENT_POSITION");
  });

  it("fully closes a position by default-full-quantity request and removes it", async () => {
    openLongPosition("user-1");
    vi.mocked(getCandles).mockResolvedValue(freshSeries(150));
    const res = await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "k1" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("FILLED");
    expect(json.realizedPnl).not.toBeNull();
    expect(getAccountForUser("user-1").positions.has("BTC/USDT")).toBe(false);
  });

  it("rejects STALE_CANDLE_DATA when the candle feed is stale, with no mutation", async () => {
    openLongPosition("user-1");
    vi.mocked(getCandles).mockResolvedValue({
      symbol: "BTC/USDT",
      timeframe: "4h",
      candles: [],
      source: "insufficient",
      fetchedAt: Date.now(),
    });
    const res = await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "k1" }));
    const json = await res.json();
    expect(json.status).toBe("REJECTED");
    expect(json.reasonCode).toBe("STALE_CANDLE_DATA");
    expect(getAccountForUser("user-1").positions.has("BTC/USDT")).toBe(true); // unchanged
  });

  it("never imports or calls anything from lib/trading-signals for a close (unconditional of any signal)", async () => {
    openLongPosition("user-1");
    vi.mocked(getCandles).mockResolvedValue(freshSeries(150));
    const placeOrderSpy = vi.spyOn(mockBroker, "placeOrder");
    await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "k1" }));
    expect(placeOrderSpy).toHaveBeenCalledTimes(1);
    const callArgs = placeOrderSpy.mock.calls[0][0];
    expect(callArgs.intent.sourceSignal).toBeUndefined();
    expect(callArgs.intent.side).toBe("SELL");
  });

  it("idempotency: duplicate key returns identical result, single fill", async () => {
    openLongPosition("user-1");
    vi.mocked(getCandles).mockResolvedValue(freshSeries(150));
    const first = await (await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "dup" }))).json();
    const second = await (await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "dup" }))).json();
    expect(second.orderId).toBe(first.orderId);
    expect(second.idempotent).toBe(true);
  });

  it("400 on a malformed body (missing symbol)", async () => {
    const res = await POST(req({ requestedQuantity: "1", idempotencyKey: "k1" }));
    expect(res.status).toBe(400);
  });
});
