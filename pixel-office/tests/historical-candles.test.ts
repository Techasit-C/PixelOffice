import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchHistoricalCandles } from "@/lib/market-data/historical-candles";

const H = 3_600_000; // 1h duration for compact fixtures

function row(openTime: number, close = 100): unknown[] {
  return [openTime, close, close + 1, close - 1, close, "10", openTime + H, "1000"];
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as unknown as Response;
}

describe("fetchHistoricalCandles — single page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns all rows from a single page under the 500-row cap", async () => {
    const rows = [row(0), row(H), row(2 * H)];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(rows));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 3 * H - 1);

    expect(result.failed).toBe(false);
    expect(result.candles.map((c) => c.openTime)).toEqual([0, H, 2 * H]);
  });

  it("drops malformed rows and counts them", async () => {
    const rows = [row(0), ["not", "a", "candle"], row(H)];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(rows));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 2 * H - 1);

    expect(result.candles.length).toBe(2);
    expect(result.malformedCount).toBe(1);
  });

  it("reports failed=true on a non-200 response without throwing", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([], false));
    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, H);
    expect(result.failed).toBe(true);
  });
});

describe("fetchHistoricalCandles — pagination across pages", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("advances the cursor past the last row of a full (500-row) page", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => row(i * H));
    const page2 = [row(500 * H), row(501 * H)];
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(page1)).mockResolvedValueOnce(jsonResponse(page2));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 502 * H - 1);

    expect(result.candles.length).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondCallUrl).toContain(`startTime=${500 * H}`);
  });

  it("stops without a second request when a page returns fewer than 500 rows", async () => {
    const page1 = [row(0), row(H)];
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(page1));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 2 * H - 1);

    expect(result.candles.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes an overlapping page instead of duplicating rows", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => row(i * H));
    // page2 overlaps: repeats the last 2 rows of page1 before advancing.
    const page2 = [row(498 * H), row(499 * H), row(500 * H)];
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(page1)).mockResolvedValueOnce(jsonResponse(page2));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 501 * H - 1);

    const openTimes = result.candles.map((c) => c.openTime);
    expect(openTimes.length).toBe(new Set(openTimes).size); // no duplicate openTime
    expect(openTimes[openTimes.length - 1]).toBe(500 * H);
  });

  it("fails with PAGINATION_CURSOR_STUCK when a page is byte-identical to the previous one", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => row(i * H));
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(page1)).mockResolvedValueOnce(jsonResponse(page1));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 1000 * H - 1);

    expect(result.failed).toBe(true);
    expect(result.failureReason).toBe("PAGINATION_CURSOR_STUCK");
  });

  it("truncates and reports it after MAX_PAGES_PER_TIMEFRAME (20) full pages", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    for (let p = 0; p < 25; p++) {
      const page = Array.from({ length: 500 }, (_, i) => row((p * 500 + i) * H));
      fetchMock.mockResolvedValueOnce(jsonResponse(page));
    }
    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 20_000 * H - 1);

    expect(result.truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});

describe("fetchHistoricalCandles — retry and cancellation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries exactly once on a network throw, then succeeds", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(jsonResponse([row(0)]));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, H - 1);

    expect(result.failed).toBe(false);
    expect(result.candles.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails after the network throws twice in a row (retry exhausted)", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error("network down")).mockRejectedValueOnce(new Error("still down"));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, H - 1);

    expect(result.failed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops immediately and reports failed when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, H - 1, controller.signal);

    expect(result.failed).toBe(true);
    expect(result.failureReason).toBe("CANCELLED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
