import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchBacktestHistory } from "@/lib/market-data/historical-candles";

const H4 = 14_400_000;

function row(openTime: number): unknown[] {
  return [openTime, 100, 101, 99, 100, "10", openTime + H4, "1000"];
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as unknown as Response;
}

describe("fetchBacktestHistory", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([row(0)])));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches primary, 1h, and 1d concurrently and returns all three results", async () => {
    const bundle = await fetchBacktestHistory("BTCUSDT", 100 * H4, 110 * H4);
    expect(bundle.primary).toBeDefined();
    expect(bundle.oneHour).toBeDefined();
    expect(bundle.oneDay).toBeDefined();
  });

  it("requests each timeframe with its own warm-up-extended start time", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    await fetchBacktestHistory("BTCUSDT", 100 * H4, 110 * H4);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("interval=4h") && u.includes(`startTime=${100 * H4 - 60 * H4}`))).toBe(true);
    expect(urls.some((u) => u.includes("interval=60m") && u.includes(`startTime=${100 * H4 - 50 * 3_600_000}`))).toBe(true);
    expect(urls.some((u) => u.includes("interval=1d") && u.includes(`startTime=${100 * H4 - 50 * 86_400_000}`))).toBe(true);
  });

  it("propagates a shared AbortSignal to every timeframe's fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    const bundle = await fetchBacktestHistory("BTCUSDT", 100 * H4, 110 * H4, controller.signal);
    expect(bundle.primary.failed).toBe(true);
    expect(bundle.oneHour.failed).toBe(true);
    expect(bundle.oneDay.failed).toBe(true);
  });
});
