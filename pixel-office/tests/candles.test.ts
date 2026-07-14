// Candle provider — HONESTY + keyless-build tests. The provider must never throw,
// never fabricate OHLCV, and degrade to source:"insufficient" on any failure. All
// network is stubbed; there is no real I/O and no API key involved.
import { describe, it, expect, vi, afterEach } from "vitest";
import { getCandles, __resetCandleCache } from "@/lib/market-data/candles";

afterEach(() => {
  __resetCandleCache();
  vi.unstubAllGlobals();
});

describe("getCandles (keyless public provider)", () => {
  it("no network / fetch rejects => insufficient, empty, no throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network")));
    const series = await getCandles("BTCUSDT", "4h", 200);
    expect(series.source).toBe("insufficient");
    expect(series.candles).toEqual([]);
    expect(series.symbol).toBe("BTCUSDT");
    expect(series.timeframe).toBe("4h");
  });

  it("non-200 response => insufficient, empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 451, statusText: "blocked" }),
    );
    const series = await getCandles("ETHUSDT", "1h", 200);
    expect(series.source).toBe("insufficient");
    expect(series.candles).toEqual([]);
  });

  it("non-array JSON body => insufficient (never fabricates)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: "nope" }) }),
    );
    const series = await getCandles("SOLUSDT", "1d", 200);
    expect(series.source).toBe("insufficient");
    expect(series.candles).toEqual([]);
  });

  it("too few usable rows => insufficient (does not zero-fill)", async () => {
    const rows = [[1, 10, 11, 9, 10.5, 100]]; // only 1 bar
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => rows }));
    const series = await getCandles("BTCUSDT", "4h", 200);
    expect(series.source).toBe("insufficient");
    expect(series.candles).toEqual([]);
  });

  it("valid rows => live, parsed, chronologically sorted", async () => {
    // Deliberately out of order to prove the provider sorts by openTime.
    const rows = [
      [3, 12, 13, 11, 12.5, 300],
      [1, 10, 11, 9, 10.5, 100],
      [2, 11, 12, 10, 11.5, 200, "extra-ignored-field"],
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => rows }));
    const series = await getCandles("BTCUSDT", "1h", 200);
    expect(series.source).toBe("live");
    expect(series.candles.map((c) => c.openTime)).toEqual([1, 2, 3]);
    expect(series.candles[0]).toEqual({
      openTime: 1,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 100,
    });
  });

  it("drops rows with non-finite fields rather than inventing values", async () => {
    const rows = [
      [1, 10, 11, 9, 10.5, 100],
      [2, "bad", 12, 10, 11.5, 200],
      [3, 12, 13, 11, 12.5, 300],
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => rows }));
    const series = await getCandles("BTCUSDT", "4h", 200);
    expect(series.source).toBe("live");
    expect(series.candles.map((c) => c.openTime)).toEqual([1, 3]);
  });

  it("does not send Authorization/API-key headers (keyless build still works)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    await getCandles("BTCUSDT", "4h", 200);
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(keys).not.toContain("authorization");
    expect(keys.some((k) => k.includes("api-key") || k.includes("apikey"))).toBe(false);
  });

  it("coalesces concurrent identical requests into a single fetch", async () => {
    let resolveFetch: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveFetch = resolve; });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetchMock);

    const call1 = getCandles("BTCUSDT", "4h", 200);
    const call2 = getCandles("BTCUSDT", "4h", 200);
    resolveFetch!({
      ok: true,
      json: async () => [[1, 10, 11, 9, 10.5, 100], [2, 11, 12, 10, 11.5, 200]],
    });
    const [series1, series2] = await Promise.all([call1, call2]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(series1.candles.length).toBe(2);
    expect(series2.candles.length).toBe(2);
  });

  it("does not coalesce requests with different cache keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [[1, 10, 11, 9, 10.5, 100], [2, 11, 12, 10, 11.5, 200]],
    });
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([getCandles("BTCUSDT", "4h", 200), getCandles("ETHUSDT", "4h", 200)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("removes a failed/timed-out request from in-flight so an immediate retry issues a new fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [[1, 10, 11, 9, 10.5, 100], [2, 11, 12, 10, 11.5, 200]],
      });
    vi.stubGlobal("fetch", fetchMock);

    const first = await getCandles("BTCUSDT", "4h", 200);
    expect(first.source).toBe("insufficient");

    const second = await getCandles("BTCUSDT", "4h", 200);
    expect(second.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
