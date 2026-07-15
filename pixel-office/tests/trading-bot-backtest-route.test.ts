import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "user-1", clerkUserId: "clerk-1" }),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));

const H4 = 14_400_000;
function row(openTime: number): unknown[] {
  return [openTime, 100, 101, 99, 100, "10", openTime + H4, "1000"];
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as unknown as Response;
}

describe("POST /api/trading-bot/backtest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([row(0)])));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("rejects an unsupported symbol with 400, before any fetch is attempted", async () => {
    const { POST } = await import("@/app/api/trading-bot/backtest/route");
    const req = new Request("http://localhost/api/trading-bot/backtest", {
      method: "POST",
      body: JSON.stringify({ symbol: "DOGE/USDT", requestedStart: 0, requestedEnd: 10 * 86_400_000 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a range larger than MAX_REQUESTED_RANGE_DAYS with 400", async () => {
    const { POST } = await import("@/app/api/trading-bot/backtest/route");
    const req = new Request("http://localhost/api/trading-bot/backtest", {
      method: "POST",
      body: JSON.stringify({ symbol: "BTC/USDT", requestedStart: 0, requestedEnd: 400 * 86_400_000 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-bounds initialBalance with 400", async () => {
    const { POST } = await import("@/app/api/trading-bot/backtest/route");
    const req = new Request("http://localhost/api/trading-bot/backtest", {
      method: "POST",
      body: JSON.stringify({
        symbol: "BTC/USDT", requestedStart: 0, requestedEnd: 10 * 86_400_000, initialBalance: 50,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("never accepts a user-supplied provider URL field", async () => {
    const { POST } = await import("@/app/api/trading-bot/backtest/route");
    const req = new Request("http://localhost/api/trading-bot/backtest", {
      method: "POST",
      body: JSON.stringify({
        symbol: "BTC/USDT", requestedStart: 0, requestedEnd: 10 * 86_400_000,
        providerUrl: "https://evil.example.com",
      }),
    });
    const res = await POST(req);
    // The schema has no providerUrl field — zod strips/ignores it; the route must
    // never read an unvalidated field off the raw body for the fetch URL.
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(fetchCalls.every((u) => u.startsWith("https://api.mexc.com/"))).toBe(true);
    expect(res.status).not.toBe(500);
  });
});
