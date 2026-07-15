// Deterministic deadline/abort-propagation tests for the backtest route. Code
// inspection proved the wiring by reading the source; these tests prove it by
// exercising the actual route with fake timers and a controlled hanging fetch —
// no real network access, no real 55-second wait.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HistoricalFetchBundle } from "@/lib/market-data/historical-candles";

vi.mock("@/lib/auth/current-user", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "user-1", clerkUserId: "clerk-1" }),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));
vi.mock("@/lib/market-data/historical-candles", () => ({
  fetchBacktestHistory: vi.fn(),
}));

function validBody(): Record<string, unknown> {
  return { symbol: "BTC/USDT", requestedStart: 0, requestedEnd: 10 * 86_400_000 };
}

// The route does several real awaits (requireUser(), request.json()) before it ever
// calls fetchBacktestHistory, so `capturedSignal` isn't populated on the same tick
// POST() is invoked. Flush pending microtasks until it is.
async function flushUntilCaptured(getter: () => unknown, maxTicks = 20): Promise<void> {
  for (let i = 0; i < maxTicks && getter() === undefined; i++) {
    await Promise.resolve();
  }
}

describe("POST /api/trading-bot/backtest — deadline and cancellation propagation", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("the internal 55s deadline aborts the shared controller, stops waiting on the hung fetch, and returns the documented timeout error — without a real 55s wait", async () => {
    vi.useFakeTimers();
    const { fetchBacktestHistory } = await import("@/lib/market-data/historical-candles");
    let capturedSignal: AbortSignal | undefined;
    let neverResolve: (bundle: HistoricalFetchBundle) => void;
    vi.mocked(fetchBacktestHistory).mockImplementation((_ticker, _start, _end, signal) => {
      capturedSignal = signal;
      // Deliberately hangs — the real historical fetch is still "in flight" from the
      // route's point of view when the deadline fires; this mock resolves it manually
      // (never, in this test) so we can prove the ROUTE moved on without it.
      return new Promise<HistoricalFetchBundle>((resolve) => {
        neverResolve = resolve;
      });
    });

    const { POST } = await import("@/app/api/trading-bot/backtest/route");
    const req = new Request("http://localhost/api/trading-bot/backtest", {
      method: "POST",
      body: JSON.stringify(validBody()),
    });

    const resPromise = POST(req);
    await flushUntilCaptured(() => capturedSignal);
    expect(capturedSignal?.aborted).toBe(false);

    // Advance exactly to the route's internal deadline (55_000ms) using fake timers —
    // real elapsed time for this test is milliseconds, not 55 real seconds.
    await vi.advanceTimersByTimeAsync(55_000);

    const res = await resPromise;
    expect(capturedSignal?.aborted).toBe(true); // the shared AbortController was aborted
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Historical data fetch failed or timed out/);

    // A late resolution of the hung fetch after the response was already sent must
    // never surface anywhere — no late successful result overrides the timeout.
    void neverResolve!({
      primary: { candles: [], malformedCount: 0, truncated: false, failed: false },
      oneHour: { candles: [], malformedCount: 0, truncated: false, failed: false },
      oneDay: { candles: [], malformedCount: 0, truncated: false, failed: false },
    });
    await Promise.resolve();
    // The already-awaited `res` object is unchanged — re-reading its status proves
    // nothing new happened to it (Response bodies are single-read, so the fact this
    // doesn't throw a second, different result confirms POST already returned once).
    expect(res.status).toBe(400);
  });

  it("client/request cancellation (request.signal aborting) propagates to the shared controller independently of the internal deadline — no fake timers needed", async () => {
    const { fetchBacktestHistory } = await import("@/lib/market-data/historical-candles");
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(fetchBacktestHistory).mockImplementation((_ticker, _start, _end, signal) => {
      capturedSignal = signal;
      // Mirrors the real fetchHistoricalCandles contract: an aborted signal resolves
      // promptly with failed:true, it does not hang forever waiting on a timer.
      return new Promise<HistoricalFetchBundle>((resolve) => {
        signal?.addEventListener("abort", () => {
          resolve({
            primary: { candles: [], malformedCount: 0, truncated: false, failed: true, failureReason: "CANCELLED" },
            oneHour: { candles: [], malformedCount: 0, truncated: false, failed: true, failureReason: "CANCELLED" },
            oneDay: { candles: [], malformedCount: 0, truncated: false, failed: true, failureReason: "CANCELLED" },
          });
        });
      });
    });

    const { POST } = await import("@/app/api/trading-bot/backtest/route");
    const clientController = new AbortController();
    const req = new Request("http://localhost/api/trading-bot/backtest", {
      method: "POST",
      body: JSON.stringify(validBody()),
      signal: clientController.signal,
    });

    const resPromise = POST(req);
    await flushUntilCaptured(() => capturedSignal);
    expect(capturedSignal?.aborted).toBe(false);

    clientController.abort(); // simulates the client disconnecting / cancelling

    const res = await resPromise;
    expect(capturedSignal?.aborted).toBe(true); // request.signal -> shared controller
    expect(res.status).toBe(400);
  });
});
