import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/auth/current-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/market-data/candles", () => ({ getCandles: vi.fn() }));

import { requireUser } from "@/lib/auth/current-user";
import { Unauthorized } from "@/lib/api/errors";
import { getCandles } from "@/lib/market-data/candles";
import { GET as accountGET } from "@/app/api/trading-bot/account/route";
import { GET as positionsGET } from "@/app/api/trading-bot/positions/route";
import { __resetRateLimiters } from "@/lib/api/rate-limit";
import { __resetTradingBotStore, getAccountForUser } from "@/lib/trading-bot/store";

beforeEach(() => {
  __resetTradingBotStore();
  __resetRateLimiters();
  vi.mocked(requireUser).mockReset();
  vi.mocked(getCandles).mockReset();
});

describe("GET /api/trading-bot/account", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Unauthorized());
    const res = await accountGET();
    expect(res.status).toBe(401);
  });

  it("returns the starting balance as a string for a fresh user, with no positions", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", clerkUserId: "c1" });
    const res = await accountGET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.currency).toBe("USDT");
    expect(typeof json.cashBalance).toBe("string");
    expect(json.cashBalance).toBe("10000");
    expect(json.positions).toEqual([]);
  });

  it("includes marketValue/unrealizedPnl as strings when a position + fresh quote exist", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", clerkUserId: "c1" });
    const account = getAccountForUser("user-1");
    account.positions.set("BTC/USDT", {
      symbol: "BTC/USDT",
      quantity: new Prisma.Decimal("1"),
      avgEntryPrice: new Prisma.Decimal("100"),
      realizedPnl: new Prisma.Decimal("0"),
    });
    vi.mocked(getCandles).mockResolvedValue({
      symbol: "BTC/USDT",
      timeframe: "4h",
      candles: [{ openTime: Date.now(), open: 100, high: 160, low: 95, close: 150, volume: 1 }],
      source: "live",
      fetchedAt: Date.now(),
    });
    const res = await accountGET();
    const json = await res.json();
    const position = json.positions[0];
    expect(typeof position.marketValue).toBe("string");
    expect(position.marketValue).toBe("150");
    expect(typeof position.unrealizedPnl).toBe("string");
    expect(position.unrealizedPnl).toBe("50");
  });
});

describe("GET /api/trading-bot/positions", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Unauthorized());
    const res = await positionsGET();
    expect(res.status).toBe(401);
  });

  it("returns positions with string quantity/avgEntryPrice/realizedPnl fields", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", clerkUserId: "c1" });
    const account = getAccountForUser("user-1");
    account.positions.set("BTC/USDT", {
      symbol: "BTC/USDT",
      quantity: new Prisma.Decimal("1"),
      avgEntryPrice: new Prisma.Decimal("100"),
      realizedPnl: new Prisma.Decimal("0"),
    });
    const res = await positionsGET();
    const json = await res.json();
    expect(res.status).toBe(200);
    const position = json.positions[0];
    expect(typeof position.quantity).toBe("string");
    expect(typeof position.avgEntryPrice).toBe("string");
    expect(typeof position.realizedPnl).toBe("string");
  });
});
