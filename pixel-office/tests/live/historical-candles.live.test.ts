// LIVE, NETWORK-DEPENDENT test. Requires an explicit opt-in: only runs when
// RUN_LIVE_MEXC_TESTS=1 is set. `npm test` never sets this, so this file is a no-op
// (all tests skipped) in the default suite and in CI unless CI is explicitly
// configured to set the variable. Public, keyless, read-only endpoint.
//
// Two `it` blocks, NOT one request total: the first issues exactly one raw request
// to the klines endpoint; the second calls fetchHistoricalCandles over a 1000-hour
// range, which paginates internally and issues at least two page requests (proving
// real end-to-end pagination past the 500-row cap) and never more than
// MAX_PAGES_PER_TIMEFRAME (20). Every individual page request is independently
// timeout-protected (6s, see historical-candles.ts's PAGE_TIMEOUT_MS); each `it`
// block additionally has a 10s Vitest test timeout.
//
// Run manually (also available as `npm run test:live` with the env var set):
//   PowerShell : $env:RUN_LIVE_MEXC_TESTS='1'; npx vitest run tests/live/historical-candles.live.test.ts
//   bash       : RUN_LIVE_MEXC_TESTS=1 npx vitest run tests/live/historical-candles.live.test.ts
import { describe, it, expect } from "vitest";
import { fetchHistoricalCandles } from "@/lib/market-data/historical-candles";

const LIVE_ENABLED = process.env.RUN_LIVE_MEXC_TESTS === "1";

describe.skipIf(!LIVE_ENABLED)("live MEXC klines contract (network required, opt-in only)", () => {
  it(
    "a single raw request for >500 rows is still capped at exactly 500 by the server",
    async () => {
      // Hits the raw endpoint directly (bypassing our own pagination wrapper) to
      // verify MEXC's own single-page behavior in isolation — the empirically-observed
      // contract this whole module is built on. Our pagination logic's handling of
      // that cap is already covered by the mocked tests in historical-candles.test.ts.
      const res = await fetch("https://api.mexc.com/api/v3/klines?symbol=BTCUSDT&interval=60m&limit=1000");
      expect(res.ok).toBe(true);
      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(500);
    },
    10_000,
  );

  it(
    "fetchHistoricalCandles correctly paginates past the 500-row cap end-to-end",
    async () => {
      const now = Date.now();
      const result = await fetchHistoricalCandles("BTCUSDT", "1h", now - 1000 * 3_600_000, now);
      expect(result.failed).toBe(false);
      expect(result.candles.length).toBeGreaterThan(500); // proves real pagination occurred, not just a single page
    },
    10_000,
  );
});

if (!LIVE_ENABLED) {
  describe("live MEXC klines contract (skipped — set RUN_LIVE_MEXC_TESTS=1 to run)", () => {
    it("is intentionally skipped by default", () => {
      expect(LIVE_ENABLED).toBe(false);
    });
  });
}
