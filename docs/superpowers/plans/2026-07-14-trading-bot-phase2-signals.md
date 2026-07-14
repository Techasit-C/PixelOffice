# AI Trading Bot — Phase 2 Implementation Plan (Extended Signal Analysis)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `lib/trading-signals/` with MACD, Bollinger Bands, multi-timeframe (1h/1d confirming 4h) confidence enrichment, corrected closed-candle/staleness detection, in-flight request dedup, and deterministic plain-language explanations — integrated into `SignalEngineStrategy` and `/trading-bot`.

**Architecture:** Enrichment is a new, additive pass (`applyPhase2Enrichment`) wired into `engine.ts` between the existing `detectSetup()` and `riskGate()` calls. `detectSetup()` itself is never modified. Enrichment can only change `confidence` and `reasoning` — never `direction` or any price/risk field.

**Tech Stack:** Same as Phase 1 — TypeScript, Vitest (node, no DB/network), pure deterministic functions with injected clocks for testability.

**Spec:** `docs/superpowers/specs/2026-07-14-trading-bot-phase2-signals-design.md` (approved for implementation planning, 2026-07-14).

## Global Constraints

- `detectSetup()` and all entry/stop/target/R:R calculations remain byte-identical — enforced by a pinned baseline test (Task 1) and by `applyPhase2Enrichment`'s copy-through structure (Task 8).
- Enrichment changes only `confidence` and `reasoning`. `WAIT` (`rawSetup === null`) always stays `WAIT`.
- Staleness formula: `stale = now - last.openTime > 2 × TIMEFRAME_DURATION_MS[timeframe] + STALE_GRACE_MS` (measured from the *next expected close*, not the last candle's own open time). Fresh at exactly the boundary; stale only strictly past it.
- Clock is server-authoritative: `generatedAt` (always server-computed at every real call site) is parsed once internally to a local `analysisNow`; no client-supplied timestamp ever reaches staleness/closed-candle logic.
- `lib/market-data/candles.ts` gets in-flight request coalescing (new), on top of its existing completed-response TTL cache (unchanged). A failed/timed-out request is never left cached, in either the completed cache or the in-flight map.
- `SignalEngineStrategy.generateIntent`'s public `Strategy` interface signature and the `SourceSignal` type are unchanged. Only its internal fetch behavior changes (adds 1h/1d confirmation fetches for parity with the display path).
- `SHORT` remains visible-but-non-executable — `SignalEngineStrategy` still rejects it before constructing a `TradeIntent`.
- Confidence is documented and labeled everywhere as a heuristic score, never a probability.
- No persistence, no live trading, no broker credentials, no automation, no leverage/margin/short-execution. `lib/trading-signals/`'s safety invariant (no order/withdraw/transfer/execute capability) is never weakened.
- Confirmation timeframes are hardcoded to exactly `{1h, 1d}` confirming a `4h` primary — not a generalized N-timeframe framework.
- The pre-existing unrelated working-tree change (`pixel-office/components/portfolio/ui.tsx`) is never staged or committed by any task in this plan.

---

## File Structure

```
pixel-office/
  lib/trading-signals/
    config.ts             — MODIFY: add STALE_GRACE_MS, CONFIRMATION_MIN_BARS,
                             MAX_CONCURRENT_CANDLE_FETCHES, BOLLINGER_PERIOD,
                             BOLLINGER_STDDEV_MULT (additive only)
    types.ts               — MODIFY: additive optional TradingSignal fields
    indicators.ts            — MODIFY: add emaSeries() export (ema() untouched)
    candle-closed.ts           — NEW: isClosed / dropUnclosedTrailing / toClosedSeries
    macd.ts                      — NEW: macd() composite
    bollinger.ts                   — NEW: bollingerBands()
    multi-timeframe.ts               — NEW: state derivation, 16-row table, mapWithConcurrency
    enrichment.ts                      — NEW: applyPhase2Enrichment
    explanation.ts                       — NEW: buildPlainLanguageSummary (deterministic templates)
    engine.ts                              — MODIFY: wire enrichment + confirmation fetch
  lib/market-data/
    candles.ts                               — MODIFY: in-flight request dedup
  lib/trading-bot/
    strategy.ts                                — MODIFY: confirmation-fetch parity
  components/trading-bot/
    TradingBotPageClient.tsx                     — MODIFY: display new diagnostics
  tests/
    trading-signals-detect-setup-baseline.test.ts   — NEW (Task 1)
    trading-signals-candle-closed.test.ts             — NEW (Task 2)
    candles.test.ts                                     — MODIFY (Task 3, append cases)
    trading-signals-ema-series.test.ts                    — NEW (Task 4)
    trading-signals-macd.test.ts                            — NEW (Task 5)
    trading-signals-bollinger.test.ts                         — NEW (Task 6)
    trading-signals-multi-timeframe.test.ts                     — NEW (Task 7)
    trading-signals-enrichment.test.ts                             — NEW (Task 8)
    trading-signals-engine.test.ts                                   — MODIFY (Task 10)
    trading-signals-engine-lookahead.test.ts                          — NEW (Task 10)
    trading-bot-strategy.test.ts                                        — MODIFY (Task 11)
    trading-signals-safety.test.ts                                        — verified, not modified (Task 12)
    trading-signals-explanation.test.ts                                     — NEW (Task 13)
```

All commands below run from `pixel-office/`.

---

## Checkpoint 1: Baselines, closed candles, staleness, and cache behavior

### Task 1: Pin `detectSetup()` baseline before any Phase 2 code exists

**Files:**
- Create: `tests/trading-signals-detect-setup-baseline.test.ts`

**Interfaces:**
- Consumes: `computeIndicators`, `detectSetup` (existing, `lib/trading-signals/setup.ts` — untouched).
- Produces: a committed snapshot file (`tests/__snapshots__/trading-signals-detect-setup-baseline.test.ts.snap`) that is the mechanical proof `detectSetup()` is never modified by later tasks — any accidental change to `setup.ts` will fail this test.

This task adds **no production code**. It must be committed *before* Task 8 (`enrichment.ts`) exists, so the baseline reflects pre-Phase-2 behavior.

- [ ] **Step 1: Write the baseline test**

```ts
// tests/trading-signals-detect-setup-baseline.test.ts
// PINNED BASELINE — captures detectSetup()'s exact current output via snapshot,
// committed before any Phase 2 code exists. detectSetup() is never modified by
// Phase 2 (design §4); this test proves that mechanically, not just by claim.
import { describe, it, expect } from "vitest";
import { computeIndicators, detectSetup } from "@/lib/trading-signals/setup";
import type { Candle } from "@/lib/market-data/candles";

function linspace(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1));
  return out;
}

function candlesFromCloses(closes: number[], lastVolumeHigh: boolean): Candle[] {
  const WIGGLE = 0.5;
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const isLast = i === closes.length - 1;
    return {
      openTime: i,
      open,
      high: Math.max(open, close) + WIGGLE,
      low: Math.min(open, close) - WIGGLE,
      close,
      volume: isLast && lastVolumeHigh ? 500 : 100,
    };
  });
}

describe("detectSetup — pinned baseline (Phase 2 regression guard)", () => {
  it("clean uptrend + pullback (LONG) — baseline snapshot", () => {
    const closes = [
      ...linspace(100, 170, 64),
      ...linspace(170, 158, 9).slice(1),
      ...linspace(158, 162, 9).slice(1),
    ];
    const ind = computeIndicators(candlesFromCloses(closes, true));
    expect(detectSetup(ind)).toMatchSnapshot();
  });

  it("downtrend + bounce (SHORT) — baseline snapshot", () => {
    const closes = [
      ...linspace(200, 140, 64),
      ...linspace(140, 152, 9).slice(1),
      ...linspace(152, 148, 9).slice(1),
    ];
    const ind = computeIndicators(candlesFromCloses(closes, true));
    expect(detectSetup(ind)).toMatchSnapshot();
  });

  it("flat/no-bias input — returns null (baseline)", () => {
    const closes = linspace(100, 101, 80);
    const ind = computeIndicators(candlesFromCloses(closes, false));
    expect(detectSetup(ind)).toMatchSnapshot();
  });

  it("clean uptrend, no structural levels, ATR fallback — baseline snapshot", () => {
    const closes = linspace(100, 180, 70);
    const ind = computeIndicators(candlesFromCloses(closes, true));
    expect(detectSetup(ind)).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run the test to generate and commit the snapshot**

Run: `npx vitest run trading-signals-detect-setup-baseline`
Expected: PASS (4 tests) — Vitest creates `tests/__snapshots__/trading-signals-detect-setup-baseline.test.ts.snap` on first run. Open it and confirm every field is populated (not `null`/empty) for the three non-flat fixtures — a snapshot full of `undefined` would mean the fixture itself is broken, not a valid baseline.

- [ ] **Step 3: Commit**

```bash
git add tests/trading-signals-detect-setup-baseline.test.ts tests/__snapshots__/trading-signals-detect-setup-baseline.test.ts.snap
git commit -m "test(trading-signals): pin detectSetup() baseline before Phase 2 enrichment"
```

---

### Task 2: `candle-closed.ts` — corrected closed-candle and staleness detection

**Files:**
- Modify: `lib/trading-signals/config.ts`
- Create: `lib/trading-signals/candle-closed.ts`
- Create: `tests/trading-signals-candle-closed.test.ts`

**Interfaces:**
- Consumes: `Candle` from `@/lib/market-data/candles`, `Timeframe` from `./types`.
- Produces: `TIMEFRAME_DURATION_MS`, `isClosed(candle, timeframe, now): boolean`, `dropUnclosedTrailing(candles, timeframe, now): Candle[]`, `ClosedSeriesResult`, `toClosedSeries(candles, timeframe, now): ClosedSeriesResult`. Used by `engine.ts` (Task 9) and `multi-timeframe.ts` (Task 7).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-signals-candle-closed.test.ts
import { describe, it, expect } from "vitest";
import {
  isClosed,
  dropUnclosedTrailing,
  toClosedSeries,
  TIMEFRAME_DURATION_MS,
} from "@/lib/trading-signals/candle-closed";
import { STALE_GRACE_MS } from "@/lib/trading-signals/config";
import type { Candle } from "@/lib/market-data/candles";

function candleAt(openTime: number): Candle {
  return { openTime, open: 100, high: 101, low: 99, close: 100, volume: 10 };
}

describe("isClosed", () => {
  it("is closed exactly at openTime + duration (boundary inclusive)", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    expect(isClosed(candleAt(0), "4h", duration)).toBe(true);
  });
  it("is not closed one ms before that boundary", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    expect(isClosed(candleAt(0), "4h", duration - 1)).toBe(false);
  });
});

describe("dropUnclosedTrailing", () => {
  it("drops a single trailing unclosed candle", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const now = 10_000_000;
    const candles = [candleAt(now - 3 * duration), candleAt(now - 2 * duration), candleAt(now - 100)];
    expect(dropUnclosedTrailing(candles, "4h", now).length).toBe(2);
  });

  it("drops multiple trailing unclosed candles", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const now = 10_000_000;
    const candles = [candleAt(now - 3 * duration), candleAt(now - duration - 100), candleAt(now - 50)];
    expect(dropUnclosedTrailing(candles, "4h", now).length).toBe(1);
  });

  it("keeps every candle when the last one is already closed", () => {
    const duration = TIMEFRAME_DURATION_MS["1h"];
    const now = 10_000_000;
    const candles = [candleAt(now - 3 * duration), candleAt(now - 2 * duration - 1)];
    expect(dropUnclosedTrailing(candles, "1h", now).length).toBe(2);
  });
});

describe("toClosedSeries — corrected staleness boundaries", () => {
  it("is not stale immediately after the latest candle closes", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const openTime = 0;
    const now = openTime + duration;
    expect(toClosedSeries([candleAt(openTime)], "4h", now).stale).toBe(false);
  });

  it("is NOT stale five minutes into the next (still-forming) candle — the corrected bug case", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const openTime = 0;
    const formingCandleOpen = openTime + duration;
    const now = formingCandleOpen + 5 * 60_000;
    const result = toClosedSeries([candleAt(openTime), candleAt(formingCandleOpen)], "4h", now);
    expect(result.closedCandles.length).toBe(1);
    expect(result.stale).toBe(false);
  });

  it("is fresh exactly at the next expected close plus grace", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const openTime = 0;
    const now = openTime + 2 * duration + STALE_GRACE_MS;
    expect(toClosedSeries([candleAt(openTime)], "4h", now).stale).toBe(false);
  });

  it("is stale one millisecond after that boundary", () => {
    const duration = TIMEFRAME_DURATION_MS["4h"];
    const openTime = 0;
    const now = openTime + 2 * duration + STALE_GRACE_MS + 1;
    expect(toClosedSeries([candleAt(openTime)], "4h", now).stale).toBe(true);
  });

  it("treats a genuinely stalled feed as stale", () => {
    const duration = TIMEFRAME_DURATION_MS["1d"];
    const now = 10 * duration;
    expect(toClosedSeries([candleAt(0)], "1d", now).stale).toBe(true);
  });

  it("treats an empty candle array as stale/unavailable", () => {
    const result = toClosedSeries([], "1h", 1000);
    expect(result.stale).toBe(true);
    expect(result.closedCandles).toEqual([]);
  });

  it("applies the identical rule to 1h, 4h, and 1d", () => {
    for (const tf of ["1h", "4h", "1d"] as const) {
      const duration = TIMEFRAME_DURATION_MS[tf];
      const freshNow = 0 + 2 * duration + STALE_GRACE_MS;
      expect(toClosedSeries([candleAt(0)], tf, freshNow).stale).toBe(false);
      expect(toClosedSeries([candleAt(0)], tf, freshNow + 1).stale).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run trading-signals-candle-closed`
Expected: FAIL with "Cannot find module '@/lib/trading-signals/candle-closed'"

- [ ] **Step 3: Add `STALE_GRACE_MS` to `lib/trading-signals/config.ts`**

Append at the end of the file:

```ts

// --- Phase 2: closed-candle / staleness (candle-closed.ts) -------------------
/** Grace period beyond one full timeframe interval before a series is stale. */
export const STALE_GRACE_MS = 5 * 60_000;
```

- [ ] **Step 4: Create `lib/trading-signals/candle-closed.ts`**

```ts
// Closed-candle and staleness detection — the two distinct concepts Phase 2
// requires: CLOSED (has this candle's period actually ended yet, so it's safe
// to run indicator math on) vs FRESH (has a new closed candle arrived recently
// enough to trust the feed). Both take an injected `now` (always the caller's
// server-authoritative analysisNow — see engine.ts) — never a client timestamp.
import type { Candle } from "@/lib/market-data/candles";
import type { Timeframe } from "./types";
import { STALE_GRACE_MS } from "./config";

export const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export function isClosed(candle: Candle, timeframe: Timeframe, now: number): boolean {
  return now >= candle.openTime + TIMEFRAME_DURATION_MS[timeframe];
}

/** Strips ANY number of trailing candles whose period has not yet ended. */
export function dropUnclosedTrailing(candles: Candle[], timeframe: Timeframe, now: number): Candle[] {
  let end = candles.length;
  while (end > 0 && !isClosed(candles[end - 1], timeframe, now)) end--;
  return candles.slice(0, end);
}

export interface ClosedSeriesResult {
  closedCandles: Candle[];
  stale: boolean;
  reason?: string;
}

/**
 * Staleness is measured from when the NEXT candle's close was expected
 * (last.openTime + 2×duration), not from the last candle's own open time —
 * using the last candle's own open time would falsely mark a just-closed
 * candle stale within minutes of the next candle starting to form.
 */
export function toClosedSeries(candles: Candle[], timeframe: Timeframe, now: number): ClosedSeriesResult {
  const closed = dropUnclosedTrailing(candles, timeframe, now);
  const last = closed[closed.length - 1];
  if (!last) {
    return { closedCandles: [], stale: true, reason: "no closed candles available" };
  }

  const duration = TIMEFRAME_DURATION_MS[timeframe];
  const nextExpectedCloseTime = last.openTime + 2 * duration;
  const stale = now - last.openTime > 2 * duration + STALE_GRACE_MS;

  return {
    closedCandles: closed,
    stale,
    reason: stale
      ? `next ${timeframe} candle close was expected by ${new Date(nextExpectedCloseTime).toISOString()}, past the ${Math.round(STALE_GRACE_MS / 60000)}min grace ceiling`
      : undefined,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run trading-signals-candle-closed`
Expected: PASS (11 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/trading-signals/config.ts lib/trading-signals/candle-closed.ts tests/trading-signals-candle-closed.test.ts
git commit -m "feat(trading-signals): add corrected closed-candle and staleness detection"
```

---

### Task 3: `candles.ts` — verify cache gap, add in-flight request coalescing

**Files:**
- Modify: `lib/market-data/candles.ts`
- Modify: `tests/candles.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getCandles` behavior unchanged from the caller's perspective, plus new coalescing of concurrent identical requests. `__resetCandleCache()` now also clears the in-flight map.

- [ ] **Step 1: Write a test proving today's gap (no in-flight coalescing)**

Append to `tests/candles.test.ts`, inside the existing `describe("getCandles (keyless public provider)", ...)` block:

```ts

  it("VERIFIES today's gap: concurrent identical requests currently issue TWO fetches", async () => {
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
    await Promise.all([call1, call2]);

    // Documents the PRE-fix behavior. This assertion is expected to change to
    // toHaveBeenCalledTimes(1) once in-flight coalescing is implemented below —
    // see the next test, which is the one that must pass long-term.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run to confirm it documents the current (uncoalesced) behavior**

Run: `npx vitest run candles.test`
Expected: PASS (this test currently passes because there IS no coalescing — it's a characterization test of the gap, not a red/green TDD step in the usual sense)

- [ ] **Step 3: Write the target coalescing test (this one must fail first)**

Append immediately after the previous test:

```ts

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
```

- [ ] **Step 4: Run to verify the new coalescing test fails**

Run: `npx vitest run candles.test`
Expected: FAIL on "coalesces concurrent identical requests into a single fetch" (`fetchMock` called 2 times, expected 1)

- [ ] **Step 5: Modify `lib/market-data/candles.ts`**

Find:

```ts
// Module-scoped TTL cache — mirrors the spot cache idiom in market-data/service.ts.
// Survives across requests in a warm Node runtime; per-instance in serverless.
const candleCache = new Map<string, CacheEntry>();
```

Replace with:

```ts
// Module-scoped TTL cache — mirrors the spot cache idiom in market-data/service.ts.
// Survives across requests in a warm Node runtime; per-instance in serverless.
const candleCache = new Map<string, CacheEntry>();

// In-flight coalescing: a second concurrent call for the same key reuses the
// same pending fetch instead of issuing a duplicate network request. Cleaned up
// unconditionally (success or failure) via .finally() below, so a failed/timed-
// out fetch never leaves a stuck pending entry for a later caller to hang on.
const inFlight = new Map<string, Promise<CandleSeries>>();
```

Find:

```ts
/**
 * Fetch up to `limit` public candles for `symbol` (already the exchange ticker,
 * e.g. "BTCUSDT") at `timeframe`. Cache -> live -> insufficient. Never throws.
 */
export async function getCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<CandleSeries> {
  const now = Date.now();
  const key = cacheKey(symbol, timeframe, limit);

  const cached = candleCache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    // Serve the cached series; mark provenance as "cache" unless it was itself a
    // miss (insufficient), in which case keep the honest "insufficient".
    if (cached.series.source === "insufficient") return cached.series;
    return { ...cached.series, source: "cache", fetchedAt: cached.at };
  }

  const interval = INTERVAL_MAP[timeframe];
  const url = `${KLINES_HOST}/api/v3/klines?symbol=${encodeURIComponent(
    symbol,
  )}&interval=${interval}&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      // Read-only public data; do not let Next cache stale market data.
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      // Non-200 (rate-limited, geo-blocked, upstream error) -> honest miss.
      return insufficient(symbol, timeframe, now);
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return insufficient(symbol, timeframe, now);

    const candles: Candle[] = [];
    for (const row of body) {
      const c = parseRow(row);
      if (c) candles.push(c);
    }
    if (candles.length < MIN_USABLE_BARS) {
      return insufficient(symbol, timeframe, now);
    }

    // Ensure chronological order (oldest -> newest) regardless of host ordering.
    candles.sort((a, b) => a.openTime - b.openTime);

    const series: CandleSeries = {
      symbol,
      timeframe,
      candles,
      source: "live",
      fetchedAt: now,
    };
    candleCache.set(key, { series, at: now });
    return series;
  } catch {
    // Network down / abort / timeout / bad JSON — never throw, never fabricate.
    return insufficient(symbol, timeframe, now);
  } finally {
    clearTimeout(timer);
  }
}
```

Replace with:

```ts
async function fetchAndCache(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
  key: string,
  now: number,
): Promise<CandleSeries> {
  const interval = INTERVAL_MAP[timeframe];
  const url = `${KLINES_HOST}/api/v3/klines?symbol=${encodeURIComponent(
    symbol,
  )}&interval=${interval}&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      // Read-only public data; do not let Next cache stale market data.
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      // Non-200 (rate-limited, geo-blocked, upstream error) -> honest miss.
      return insufficient(symbol, timeframe, now);
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return insufficient(symbol, timeframe, now);

    const candles: Candle[] = [];
    for (const row of body) {
      const c = parseRow(row);
      if (c) candles.push(c);
    }
    if (candles.length < MIN_USABLE_BARS) {
      return insufficient(symbol, timeframe, now);
    }

    // Ensure chronological order (oldest -> newest) regardless of host ordering.
    candles.sort((a, b) => a.openTime - b.openTime);

    const series: CandleSeries = {
      symbol,
      timeframe,
      candles,
      source: "live",
      fetchedAt: now,
    };
    candleCache.set(key, { series, at: now });
    return series;
  } catch {
    // Network down / abort / timeout / bad JSON — never throw, never fabricate.
    return insufficient(symbol, timeframe, now);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch up to `limit` public candles for `symbol` (already the exchange ticker,
 * e.g. "BTCUSDT") at `timeframe`. Cache -> in-flight -> live -> insufficient.
 * Never throws.
 */
export async function getCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<CandleSeries> {
  const now = Date.now();
  const key = cacheKey(symbol, timeframe, limit);

  const cached = candleCache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    // Serve the cached series; mark provenance as "cache" unless it was itself a
    // miss (insufficient), in which case keep the honest "insufficient".
    if (cached.series.source === "insufficient") return cached.series;
    return { ...cached.series, source: "cache", fetchedAt: cached.at };
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = fetchAndCache(symbol, timeframe, limit, key, now).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
```

Find:

```ts
/** Test seam: clear the in-memory candle cache between cases. */
export function __resetCandleCache(): void {
  candleCache.clear();
}
```

Replace with:

```ts
/** Test seam: clear the in-memory candle cache and any in-flight requests. */
export function __resetCandleCache(): void {
  candleCache.clear();
  inFlight.clear();
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run candles.test`
Expected: PASS (all original tests + 4 new ones, 13 total)

- [ ] **Step 7: Commit**

```bash
git add lib/market-data/candles.ts tests/candles.test.ts
git commit -m "feat(market-data): add in-flight request coalescing to the candle cache"
```

---

**Checkpoint 1 complete when:** Tasks 1–3 committed; run `npx vitest run trading-signals-detect-setup-baseline trading-signals-candle-closed candles.test` — expect 4 + 11 + 13 = 28 passing tests; `npx tsc --noEmit` clean.

---

## Checkpoint 2: MACD and Bollinger calculations

### Task 4: `indicators.ts` — add `emaSeries()` (pure addition, `ema()` untouched)

**Files:**
- Modify: `lib/trading-signals/indicators.ts`
- Create: `tests/trading-signals-ema-series.test.ts`

**Interfaces:**
- Produces: `emaSeries(values: number[], period: number): (number | null)[]`. Used by `macd.ts` (Task 5).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-signals-ema-series.test.ts
import { describe, it, expect } from "vitest";
import { emaSeries, ema } from "@/lib/trading-signals/indicators";

describe("emaSeries", () => {
  it("matches the scalar ema() at the final index", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const period = 3;
    const series = emaSeries(values, period);
    expect(series[series.length - 1]).toBeCloseTo(ema(values, period)!, 10);
  });

  it("returns null before the seed index, then the running EMA", () => {
    const series = emaSeries([1, 2, 3, 4, 5], 3);
    expect(series[0]).toBeNull();
    expect(series[1]).toBeNull();
    expect(series[2]).toBeCloseTo(2, 10);
    expect(series[3]).toBeCloseTo(3, 10);
    expect(series[4]).toBeCloseTo(4, 10);
  });

  it("returns all nulls when there are fewer values than the period", () => {
    expect(emaSeries([1, 2], 5)).toEqual([null, null]);
  });

  it("returns an empty array for an empty input", () => {
    expect(emaSeries([], 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run trading-signals-ema-series`
Expected: FAIL with "emaSeries is not a function" (or module export error)

- [ ] **Step 3: Add `emaSeries()` to `lib/trading-signals/indicators.ts`**

Append after the existing `ema()` function:

```ts

/**
 * Exponential moving average as a FULL series, same length as `values`. Entries
 * before the seed index (period-1) are null. Same seed/recurrence convention as
 * ema() above (SMA seed, then k=2/(period+1) forward smoothing), but retains
 * every intermediate value — needed to compute a moving average OF this series
 * (MACD's signal line), which the scalar ema() cannot support.
 */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;
  out[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run trading-signals-ema-series`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full existing indicators-dependent suite to confirm no regression**

Run: `npx vitest run trading-signals-engine`
Expected: PASS (unchanged — `ema()` itself was not touched)

- [ ] **Step 6: Commit**

```bash
git add lib/trading-signals/indicators.ts tests/trading-signals-ema-series.test.ts
git commit -m "feat(trading-signals): add emaSeries() for MACD's signal-line calculation"
```

---

### Task 5: `macd.ts`

**Files:**
- Create: `lib/trading-signals/macd.ts`
- Create: `tests/trading-signals-macd.test.ts`

**Interfaces:**
- Consumes: `emaSeries` (Task 4).
- Produces: `MacdResult`, `macd(closes, fastPeriod=12, slowPeriod=26, signalPeriod=9): MacdResult`. Used by `enrichment.ts` (Task 8), `engine.ts` (Task 9), `explanation.ts` (Task 13).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-signals-macd.test.ts
import { describe, it, expect } from "vitest";
import { macd } from "@/lib/trading-signals/macd";
import { ema, emaSeries } from "@/lib/trading-signals/indicators";

function ramp(n: number, start = 100, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

describe("macd", () => {
  it("computes macdLine as EMA(12) - EMA(26) at the latest bar, cross-checked against the trusted scalar ema()", () => {
    const closes = ramp(40);
    const result = macd(closes);
    const expectedMacdLine = ema(closes, 12)! - ema(closes, 26)!;
    expect(result.macdLine).toBeCloseTo(expectedMacdLine, 6);
  });

  it("computes signalLine as EMA(9) of the compacted macd-line series, cross-checked via emaSeries", () => {
    const closes = ramp(40);
    const fast = emaSeries(closes, 12);
    const slow = emaSeries(closes, 26);
    const macdLineSeries = closes
      .map((_, i) => (fast[i] !== null && slow[i] !== null ? fast[i]! - slow[i]! : null))
      .filter((v): v is number => v !== null);
    const expectedSignal = ema(macdLineSeries, 9);
    const result = macd(closes);
    expect(result.signalLine).toBeCloseTo(expectedSignal!, 6);
    expect(result.histogram).toBeCloseTo(result.macdLine! - result.signalLine!, 10);
  });

  it("is unavailable (all null) below the 34-bar warm-up floor", () => {
    expect(macd(ramp(33))).toEqual({ macdLine: null, signalLine: null, histogram: null });
  });

  it("is available at exactly the 34-bar warm-up floor", () => {
    const result = macd(ramp(34));
    expect(result.macdLine).not.toBeNull();
    expect(result.signalLine).not.toBeNull();
  });

  it("a strong sustained uptrend produces a positive histogram", () => {
    const result = macd(ramp(40, 100, 2));
    expect(result.histogram).toBeGreaterThan(0);
  });

  it("a strong sustained downtrend produces a negative histogram", () => {
    const result = macd(ramp(40, 200, -2));
    expect(result.histogram).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run trading-signals-macd`
Expected: FAIL with "Cannot find module '@/lib/trading-signals/macd'"

- [ ] **Step 3: Create `lib/trading-signals/macd.ts`**

```ts
// MACD (Moving Average Convergence Divergence). Deterministic, no I/O.
// Warm-up: slowPeriod (26) bars to seed the slow EMA, + signalPeriod (9) more
// MACD-line values to seed the signal EMA => 34 bars minimum. Within the
// existing MIN_BARS=60 floor. Full precision throughout; rounding only at
// display time in reasoning strings, matching the existing convention.
import { emaSeries } from "./indicators";

export interface MacdResult {
  macdLine: number | null;
  signalLine: number | null;
  histogram: number | null;
}

export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  if (closes.length < slowPeriod + signalPeriod - 1) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const fast = emaSeries(closes, fastPeriod);
  const slow = emaSeries(closes, slowPeriod);
  const macdLineSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const f = fast[i];
    const s = slow[i];
    if (f !== null && s !== null) macdLineSeries.push(f - s);
  }

  if (macdLineSeries.length < signalPeriod) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const macdLine = macdLineSeries[macdLineSeries.length - 1];
  const signalSeries = emaSeries(macdLineSeries, signalPeriod);
  const signalLine = signalSeries[signalSeries.length - 1];
  if (signalLine === null) {
    return { macdLine, signalLine: null, histogram: null };
  }

  return { macdLine, signalLine, histogram: macdLine - signalLine };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run trading-signals-macd`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/trading-signals/macd.ts tests/trading-signals-macd.test.ts
git commit -m "feat(trading-signals): add MACD calculation"
```

---

### Task 6: `bollinger.ts`

**Files:**
- Modify: `lib/trading-signals/config.ts`
- Create: `lib/trading-signals/bollinger.ts`
- Create: `tests/trading-signals-bollinger.test.ts`

**Interfaces:**
- Consumes: `sma` (existing, `indicators.ts`, untouched).
- Produces: `BollingerResult`, `bollingerBands(closes, period=BOLLINGER_PERIOD, stdDevMult=BOLLINGER_STDDEV_MULT): BollingerResult`. Used by `enrichment.ts` (Task 8), `engine.ts` (Task 9), `explanation.ts` (Task 13).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-signals-bollinger.test.ts
import { describe, it, expect } from "vitest";
import { bollingerBands } from "@/lib/trading-signals/bollinger";

function flat(n: number, value = 100): number[] {
  return new Array(n).fill(value);
}

describe("bollingerBands", () => {
  it("is unavailable below the 20-bar warm-up floor", () => {
    expect(bollingerBands(flat(19))).toEqual({ middle: null, upper: null, lower: null, percentB: null });
  });

  it("collapses to unavailable %B when stdev is zero (flat closes) — never divides by zero", () => {
    const result = bollingerBands(flat(20));
    expect(result.middle).toBe(100);
    expect(result.percentB).toBeNull();
  });

  it("computes %B < 0 when price closes below the lower band", () => {
    const closes = [...flat(19, 100), 50];
    expect(bollingerBands(closes).percentB).toBeLessThan(0);
  });

  it("computes %B = 0.2 at the neutral/lower boundary (inclusive of neutral)", () => {
    const probe = bollingerBands(flat(19, 100).concat([110]));
    const target = probe.lower! + 0.2 * (probe.upper! - probe.lower!);
    const result = bollingerBands(flat(19, 100).concat([target]));
    expect(result.percentB).toBeCloseTo(0.2, 6);
  });

  it("computes %B = 0.8 at the neutral/upper boundary", () => {
    const probe = bollingerBands(flat(19, 100).concat([110]));
    const target = probe.lower! + 0.8 * (probe.upper! - probe.lower!);
    const result = bollingerBands(flat(19, 100).concat([target]));
    expect(result.percentB).toBeCloseTo(0.8, 6);
  });

  it("computes %B > 1 when price closes above the upper band", () => {
    const closes = [...flat(19, 100), 200];
    expect(bollingerBands(closes).percentB).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run trading-signals-bollinger`
Expected: FAIL with "Cannot find module '@/lib/trading-signals/bollinger'"

- [ ] **Step 3: Add config constants to `lib/trading-signals/config.ts`**

Append after the `STALE_GRACE_MS` block added in Task 2:

```ts

// --- Phase 2: Bollinger Bands (bollinger.ts) ----------------------------------
// Deliberately independent of INDICATOR_PERIODS.smaFast (also 20) — avoids
// silently coupling two unrelated tuning knobs.
export const BOLLINGER_PERIOD = 20;
export const BOLLINGER_STDDEV_MULT = 2;
```

- [ ] **Step 4: Create `lib/trading-signals/bollinger.ts`**

```ts
// Bollinger Bands. A MEAN-REVERSION contribution layered on an otherwise
// trend-following setup (see enrichment.ts) — this module never determines
// direction, only how favorably/unfavorably the current price is positioned.
// Deterministic, no I/O.
import { sma } from "./indicators";
import { BOLLINGER_PERIOD, BOLLINGER_STDDEV_MULT } from "./config";

export interface BollingerResult {
  middle: number | null;
  upper: number | null;
  lower: number | null;
  /** %B = (close - lower) / (upper - lower). Unclamped — can be <0 or >1. */
  percentB: number | null;
}

export function bollingerBands(
  closes: number[],
  period: number = BOLLINGER_PERIOD,
  stdDevMult: number = BOLLINGER_STDDEV_MULT,
): BollingerResult {
  if (closes.length < period) {
    return { middle: null, upper: null, lower: null, percentB: null };
  }

  const window = closes.slice(closes.length - period);
  const middle = sma(closes, period)!;
  const variance = window.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stdev = Math.sqrt(variance);

  if (stdev === 0) {
    // Degenerate flat closes — bands collapse to the SMA. %B is undefined
    // (0/0), never fabricated as 0 or clamped silently.
    return { middle, upper: middle, lower: middle, percentB: null };
  }

  const upper = middle + stdDevMult * stdev;
  const lower = middle - stdDevMult * stdev;
  const lastClose = closes[closes.length - 1];
  const percentB = (lastClose - lower) / (upper - lower);

  return { middle, upper, lower, percentB };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run trading-signals-bollinger`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/trading-signals/config.ts lib/trading-signals/bollinger.ts tests/trading-signals-bollinger.test.ts
git commit -m "feat(trading-signals): add Bollinger Bands calculation"
```

---

**Checkpoint 2 complete when:** Tasks 4–6 committed; run `npx vitest run trading-signals-ema-series trading-signals-macd trading-signals-bollinger` — expect 4 + 6 + 6 = 16 passing tests; `npx tsc --noEmit` clean.

---

## Checkpoint 3: Multi-timeframe analysis and enrichment

### Task 7: `multi-timeframe.ts` — exhaustive state table and bounded fetching helper

**Files:**
- Modify: `lib/trading-signals/config.ts`
- Create: `lib/trading-signals/multi-timeframe.ts`
- Create: `tests/trading-signals-multi-timeframe.test.ts`

**Interfaces:**
- Consumes: `sma` (`indicators.ts`), `toClosedSeries` (`candle-closed.ts`, Task 2), `Candle` (`@/lib/market-data/candles`), `SignalDirection`/`Timeframe` (`types.ts`).
- Produces: `ConfirmationState`, `deriveConfirmationState(candles, timeframe, now, primaryDirection): ConfirmationState`, `scoreConfirmation(oneHour, oneDay): number`, `ConfirmationCandles`, `MultiTimeframeResult`, `confirmMultiTimeframe(input: ConfirmationCandles, primaryDirection, now): MultiTimeframeResult` (pure, synchronous — takes already-fetched candles, does no I/O itself), `mapWithConcurrency<T,R>(items, limit, fn): Promise<R[]>` (the actual fetch-bounding lives in `engine.ts`, Task 9, which calls this). Used by `enrichment.ts` (Task 8), `engine.ts` (Task 9).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-signals-multi-timeframe.test.ts
import { describe, it, expect } from "vitest";
import {
  deriveConfirmationState,
  scoreConfirmation,
  confirmMultiTimeframe,
  mapWithConcurrency,
} from "@/lib/trading-signals/multi-timeframe";
import { CONFIRMATION_MIN_BARS } from "@/lib/trading-signals/config";
import type { Candle } from "@/lib/market-data/candles";

const NOW = 1_000_000_000_000;
const HOUR = 60 * 60_000;

function trendingCandles(n: number, startClose: number, step: number, now: number, tfDuration: number): Candle[] {
  // Closed, fresh candles ending at `now`, closes moving by `step` per bar.
  return Array.from({ length: n }, (_, i) => {
    const close = startClose + i * step;
    return {
      openTime: now - (n - i) * tfDuration,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 10,
    };
  });
}

describe("deriveConfirmationState", () => {
  it("is UNAVAILABLE when there are fewer than CONFIRMATION_MIN_BARS closed candles", () => {
    const candles = trendingCandles(CONFIRMATION_MIN_BARS - 1, 100, 1, NOW, HOUR);
    expect(deriveConfirmationState(candles, "1h", NOW, "LONG")).toBe("UNAVAILABLE");
  });

  it("is ALIGNED when the timeframe's bias matches the primary direction", () => {
    const candles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 100, 1, NOW, HOUR); // uptrend
    expect(deriveConfirmationState(candles, "1h", NOW, "LONG")).toBe("ALIGNED");
  });

  it("is OPPOSITE when the timeframe's bias contradicts the primary direction", () => {
    const candles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 200, -1, NOW, HOUR); // downtrend
    expect(deriveConfirmationState(candles, "1h", NOW, "LONG")).toBe("OPPOSITE");
  });

  it("is NEUTRAL when the timeframe shows no directional bias", () => {
    const candles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 100, 0, NOW, HOUR); // flat
    expect(deriveConfirmationState(candles, "1h", NOW, "LONG")).toBe("NEUTRAL");
  });

  it("is UNAVAILABLE when the data is stale", () => {
    const candles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 100, 1, NOW - 100 * HOUR, HOUR);
    expect(deriveConfirmationState(candles, "1h", NOW, "LONG")).toBe("UNAVAILABLE");
  });
});

describe("scoreConfirmation — exhaustive 16-combination table", () => {
  const STATES = ["ALIGNED", "NEUTRAL", "UNAVAILABLE", "OPPOSITE"] as const;
  const EXPECTED: Record<string, Record<string, number>> = {
    ALIGNED: { ALIGNED: 15, NEUTRAL: 5, UNAVAILABLE: 5, OPPOSITE: -15 },
    NEUTRAL: { ALIGNED: 5, NEUTRAL: 0, UNAVAILABLE: 0, OPPOSITE: -15 },
    UNAVAILABLE: { ALIGNED: 5, NEUTRAL: 0, UNAVAILABLE: 0, OPPOSITE: -15 },
    OPPOSITE: { ALIGNED: -15, NEUTRAL: -15, UNAVAILABLE: -15, OPPOSITE: -15 },
  };

  for (const oneHour of STATES) {
    for (const oneDay of STATES) {
      it(`1h=${oneHour}, 1d=${oneDay} -> ${EXPECTED[oneHour][oneDay]}`, () => {
        expect(scoreConfirmation(oneHour, oneDay)).toBe(EXPECTED[oneHour][oneDay]);
      });
    }
  }

  it("a conflict on BOTH timeframes still applies -15 exactly once, not -30", () => {
    expect(scoreConfirmation("OPPOSITE", "OPPOSITE")).toBe(-15);
  });
});

describe("confirmMultiTimeframe", () => {
  it("combines both timeframes and reports both states in reasoning", () => {
    const oneHourCandles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 100, 1, NOW, HOUR);
    const oneDayCandles = trendingCandles(CONFIRMATION_MIN_BARS + 10, 100, 1, NOW, 24 * HOUR);
    const result = confirmMultiTimeframe({ oneHourCandles, oneDayCandles }, "LONG", NOW);
    expect(result.oneHour).toBe("ALIGNED");
    expect(result.oneDay).toBe("ALIGNED");
    expect(result.adjustment).toBe(15);
    expect(result.reasoning.join(" ")).toMatch(/1h/i);
    expect(result.reasoning.join(" ")).toMatch(/1d/i);
  });

  it("treats empty candle arrays as UNAVAILABLE for both, adjustment 0", () => {
    const result = confirmMultiTimeframe({ oneHourCandles: [], oneDayCandles: [] }, "LONG", NOW);
    expect(result.oneHour).toBe("UNAVAILABLE");
    expect(result.oneDay).toBe("UNAVAILABLE");
    expect(result.adjustment).toBe(0);
  });
});

describe("mapWithConcurrency", () => {
  it("runs every item and preserves result order regardless of completion order", async () => {
    const items = [30, 10, 20];
    const results = await mapWithConcurrency(items, 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("never runs more than `limit` items concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 8 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return i;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run trading-signals-multi-timeframe`
Expected: FAIL with "Cannot find module '@/lib/trading-signals/multi-timeframe'"

- [ ] **Step 3: Add config constants to `lib/trading-signals/config.ts`**

Append after the Bollinger block added in Task 6:

```ts

// --- Phase 2: multi-timeframe confirmation (multi-timeframe.ts) --------------
// Directional-bias-only confirmation needs less than the primary's full
// MIN_BARS — it only computes smaFast/smaSlow, not RSI/ATR/volume/MACD/BB.
export const CONFIRMATION_MIN_BARS = INDICATOR_PERIODS.smaSlow;
// Bounds simultaneous candle fetches per generateSignals() call (today's
// worst case: 3 symbols x 3 timeframes = 9; this keeps it bounded as
// SUPPORTED_SYMBOLS potentially grows).
export const MAX_CONCURRENT_CANDLE_FETCHES = 6;
```

- [ ] **Step 4: Create `lib/trading-signals/multi-timeframe.ts`**

```ts
// Multi-timeframe confirmation: does the 1h/1d directional bias agree with the
// primary (4h) signal's direction? Directional-bias-only — no stop/target/R:R
// math on confirmation timeframes. Deterministic given already-fetched candles;
// this module performs no I/O itself (see engine.ts for the actual fetching,
// bounded via mapWithConcurrency below).
import type { Candle } from "@/lib/market-data/candles";
import type { SignalDirection, Timeframe } from "./types";
import { sma } from "./indicators";
import { toClosedSeries } from "./candle-closed";
import { CONFIRMATION_MIN_BARS } from "./config";

export type ConfirmationState = "ALIGNED" | "NEUTRAL" | "UNAVAILABLE" | "OPPOSITE";

// Independent of detectSetup's own 0.2% trend-alignment gap (setup.ts) — this
// is a separate, confirmation-only flatness threshold.
const TREND_FLAT_EPSILON = 0.0005;

function classifyBias(fastSma: number, slowSma: number): "LONG" | "SHORT" | "FLAT" {
  const gap = Math.abs(fastSma - slowSma) / slowSma;
  if (gap <= TREND_FLAT_EPSILON) return "FLAT";
  return fastSma > slowSma ? "LONG" : "SHORT";
}

export function deriveConfirmationState(
  candles: Candle[],
  timeframe: Timeframe,
  now: number,
  primaryDirection: Exclude<SignalDirection, "WAIT">,
): ConfirmationState {
  const { closedCandles, stale } = toClosedSeries(candles, timeframe, now);
  if (stale || closedCandles.length < CONFIRMATION_MIN_BARS) return "UNAVAILABLE";

  const closes = closedCandles.map((c) => c.close);
  const fast = sma(closes, 20);
  const slow = sma(closes, 50);
  if (fast === null || slow === null) return "UNAVAILABLE";

  const bias = classifyBias(fast, slow);
  if (bias === "FLAT") return "NEUTRAL";
  return bias === primaryDirection ? "ALIGNED" : "OPPOSITE";
}

/** The exhaustive 16-row table (design §8): any OPPOSITE -> -15 once; else
 *  count ALIGNED: 2 -> +15, 1 -> +5, 0 -> 0. */
export function scoreConfirmation(oneHour: ConfirmationState, oneDay: ConfirmationState): number {
  if (oneHour === "OPPOSITE" || oneDay === "OPPOSITE") return -15;
  const alignedCount = [oneHour, oneDay].filter((s) => s === "ALIGNED").length;
  if (alignedCount === 2) return 15;
  if (alignedCount === 1) return 5;
  return 0;
}

export interface ConfirmationCandles {
  oneHourCandles: Candle[];
  oneDayCandles: Candle[];
}

export interface MultiTimeframeResult {
  oneHour: ConfirmationState;
  oneDay: ConfirmationState;
  adjustment: number;
  reasoning: string[];
}

export function confirmMultiTimeframe(
  input: ConfirmationCandles,
  primaryDirection: Exclude<SignalDirection, "WAIT">,
  now: number,
): MultiTimeframeResult {
  const oneHour = deriveConfirmationState(input.oneHourCandles, "1h", now, primaryDirection);
  const oneDay = deriveConfirmationState(input.oneDayCandles, "1d", now, primaryDirection);
  const adjustment = scoreConfirmation(oneHour, oneDay);
  return {
    oneHour,
    oneDay,
    adjustment,
    reasoning: [
      `1h confirmation: ${oneHour.toLowerCase()}.`,
      `1d confirmation: ${oneDay.toLowerCase()}.`,
    ],
  };
}

/** Small internal concurrency limiter — bounds simultaneous async work. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run trading-signals-multi-timeframe`
Expected: PASS (25 tests: 5 state + 16 table + 2 confirm + 2 concurrency)

- [ ] **Step 6: Commit**

```bash
git add lib/trading-signals/config.ts lib/trading-signals/multi-timeframe.ts tests/trading-signals-multi-timeframe.test.ts
git commit -m "feat(trading-signals): add multi-timeframe confirmation and bounded fetch helper"
```

---

### Task 8: `enrichment.ts` — `applyPhase2Enrichment`

**Files:**
- Create: `lib/trading-signals/enrichment.ts`
- Create: `tests/trading-signals-enrichment.test.ts`

**Interfaces:**
- Consumes: `RawSetup` (`setup.ts`, untouched), `MacdResult` (Task 5), `BollingerResult` (Task 6), `MultiTimeframeResult` (Task 7).
- Produces: `EnrichmentInputs`, `applyPhase2Enrichment(rawSetup: RawSetup | null, extras: EnrichmentInputs): RawSetup | null`. Used by `engine.ts` (Task 9).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-signals-enrichment.test.ts
import { describe, it, expect } from "vitest";
import { applyPhase2Enrichment } from "@/lib/trading-signals/enrichment";
import type { RawSetup } from "@/lib/trading-signals/setup";

function baseSetup(overrides: Partial<RawSetup> = {}): RawSetup {
  return {
    direction: "LONG",
    entryZone: { low: 99, high: 101 },
    stopLoss: 95,
    takeProfit: [{ price: 110, label: "TP1" }],
    primaryTarget: 110,
    riskRewardRatio: 2,
    observedRiskReward: 2,
    suggestedEntry: null,
    confidence: 50,
    reasoning: ["base reasoning"],
    qualityOk: true,
    ...overrides,
  };
}

const UNAVAILABLE = {
  macd: { macdLine: null, signalLine: null, histogram: null },
  bollinger: { middle: null, upper: null, lower: null, percentB: null },
  confirmation: null,
};

describe("applyPhase2Enrichment", () => {
  it("returns null unchanged when rawSetup is null (WAIT stays WAIT)", () => {
    expect(applyPhase2Enrichment(null, UNAVAILABLE)).toBeNull();
  });

  it("never changes direction, entryZone, stopLoss, takeProfit, primaryTarget, riskRewardRatio, or qualityOk", () => {
    const raw = baseSetup();
    const enriched = applyPhase2Enrichment(raw, UNAVAILABLE)!;
    expect(enriched.direction).toBe(raw.direction);
    expect(enriched.entryZone).toEqual(raw.entryZone);
    expect(enriched.stopLoss).toBe(raw.stopLoss);
    expect(enriched.takeProfit).toEqual(raw.takeProfit);
    expect(enriched.primaryTarget).toBe(raw.primaryTarget);
    expect(enriched.riskRewardRatio).toBe(raw.riskRewardRatio);
    expect(enriched.qualityOk).toBe(raw.qualityOk);
  });

  it("all-unavailable contributors leave confidence unchanged", () => {
    const raw = baseSetup({ confidence: 50 });
    expect(applyPhase2Enrichment(raw, UNAVAILABLE)!.confidence).toBe(50);
  });

  it("MACD confirming a LONG adds +10", () => {
    const raw = baseSetup({ confidence: 50, direction: "LONG" });
    const enriched = applyPhase2Enrichment(raw, {
      ...UNAVAILABLE,
      macd: { macdLine: 1, signalLine: 0.5, histogram: 0.5 },
    })!;
    expect(enriched.confidence).toBe(60);
  });

  it("MACD contradicting a LONG subtracts 10", () => {
    const raw = baseSetup({ confidence: 50, direction: "LONG" });
    const enriched = applyPhase2Enrichment(raw, {
      ...UNAVAILABLE,
      macd: { macdLine: -1, signalLine: 0.5, histogram: -1.5 },
    })!;
    expect(enriched.confidence).toBe(40);
  });

  it("Bollinger near the lower band adds +10 for LONG, subtracts 10 for SHORT", () => {
    const bollinger = { middle: 100, upper: 110, lower: 90, percentB: 0.1 };
    const longEnriched = applyPhase2Enrichment(baseSetup({ confidence: 50, direction: "LONG" }), { ...UNAVAILABLE, bollinger })!;
    const shortEnriched = applyPhase2Enrichment(baseSetup({ confidence: 50, direction: "SHORT" }), { ...UNAVAILABLE, bollinger })!;
    expect(longEnriched.confidence).toBe(60);
    expect(shortEnriched.confidence).toBe(40);
  });

  it("timeframe confirmation adjustment is applied directly", () => {
    const raw = baseSetup({ confidence: 50 });
    const enriched = applyPhase2Enrichment(raw, {
      ...UNAVAILABLE,
      confirmation: { oneHour: "ALIGNED", oneDay: "ALIGNED", adjustment: 15, reasoning: ["1h confirmation: aligned.", "1d confirmation: aligned."] },
    })!;
    expect(enriched.confidence).toBe(65);
    expect(enriched.reasoning).toEqual(
      expect.arrayContaining(["1h confirmation: aligned.", "1d confirmation: aligned."]),
    );
  });

  it("clamps confidence at 100 when contributors overflow", () => {
    const raw = baseSetup({ confidence: 95 });
    const enriched = applyPhase2Enrichment(raw, {
      macd: { macdLine: 1, signalLine: 0.5, histogram: 0.5 },
      bollinger: { middle: 100, upper: 110, lower: 90, percentB: 0.1 },
      confirmation: { oneHour: "ALIGNED", oneDay: "ALIGNED", adjustment: 15, reasoning: [] },
    })!;
    expect(enriched.confidence).toBe(100);
  });

  it("clamps confidence at 0 when contributors are maximally negative", () => {
    const raw = baseSetup({ confidence: 5, direction: "LONG" });
    const enriched = applyPhase2Enrichment(raw, {
      macd: { macdLine: -1, signalLine: 0.5, histogram: -1.5 },
      bollinger: { middle: 100, upper: 110, lower: 90, percentB: 0.9 },
      confirmation: { oneHour: "OPPOSITE", oneDay: "NEUTRAL", adjustment: -15, reasoning: [] },
    })!;
    expect(enriched.confidence).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run trading-signals-enrichment`
Expected: FAIL with "Cannot find module '@/lib/trading-signals/enrichment'"

- [ ] **Step 3: Create `lib/trading-signals/enrichment.ts`**

```ts
// Phase 2 confidence enrichment — the ONLY function allowed to change confidence
// after detectSetup(). Mechanically guaranteed to touch nothing else: every
// other RawSetup field is spread through unchanged (design §4). Called from
// engine.ts between detectSetup() and riskGate().
import type { RawSetup } from "./setup";
import type { MacdResult } from "./macd";
import type { BollingerResult } from "./bollinger";
import type { MultiTimeframeResult } from "./multi-timeframe";

export interface EnrichmentInputs {
  macd: MacdResult;
  bollinger: BollingerResult;
  confirmation: MultiTimeframeResult | null;
}

function macdAdjustment(
  direction: RawSetup["direction"],
  result: MacdResult,
): { points: number; reason: string } {
  if (result.macdLine === null || result.signalLine === null) {
    return { points: 0, reason: "MACD unavailable (insufficient bars) — no contribution." };
  }
  const confirms = direction === "LONG" ? result.macdLine > result.signalLine : result.macdLine < result.signalLine;
  return confirms
    ? { points: 10, reason: `MACD confirms ${direction.toLowerCase()} momentum (+10).` }
    : { points: -10, reason: `MACD contradicts ${direction.toLowerCase()} momentum (-10).` };
}

function bollingerAdjustment(
  direction: RawSetup["direction"],
  result: BollingerResult,
): { points: number; reason: string } {
  if (result.percentB === null) {
    return { points: 0, reason: "Bollinger Bands unavailable (flat/insufficient) — no contribution." };
  }
  const nearLower = result.percentB < 0.2;
  const nearUpper = result.percentB > 0.8;
  if (direction === "LONG") {
    if (nearLower) return { points: 10, reason: "Price near the lower Bollinger Band — favorable pullback entry (+10)." };
    if (nearUpper) return { points: -10, reason: "Price near the upper Bollinger Band — extended/chasing (-10)." };
  } else {
    if (nearUpper) return { points: 10, reason: "Price near the upper Bollinger Band — favorable bounce entry for a short (+10)." };
    if (nearLower) return { points: -10, reason: "Price near the lower Bollinger Band — already extended down (-10)." };
  }
  return { points: 0, reason: "Price within the middle Bollinger range — no mean-reversion edge either way." };
}

export function applyPhase2Enrichment(
  rawSetup: RawSetup | null,
  extras: EnrichmentInputs,
): RawSetup | null {
  if (rawSetup === null) return null;

  const macdResult = macdAdjustment(rawSetup.direction, extras.macd);
  const bbResult = bollingerAdjustment(rawSetup.direction, extras.bollinger);
  const tfPoints = extras.confirmation?.adjustment ?? 0;
  const tfReasoning = extras.confirmation?.reasoning ?? [
    "Multi-timeframe confirmation unavailable — no contribution.",
  ];

  const confidence = Math.max(
    0,
    Math.min(100, rawSetup.confidence + macdResult.points + bbResult.points + tfPoints),
  );

  return {
    ...rawSetup,
    confidence,
    reasoning: [...rawSetup.reasoning, macdResult.reason, bbResult.reason, ...tfReasoning],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run trading-signals-enrichment`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/trading-signals/enrichment.ts tests/trading-signals-enrichment.test.ts
git commit -m "feat(trading-signals): add Phase 2 enrichment (confidence/reasoning only)"
```

---

**Checkpoint 3 complete when:** Tasks 7–8 committed; run `npx vitest run trading-signals-multi-timeframe trading-signals-enrichment` — expect 25 + 9 = 34 passing tests; `npx tsc --noEmit` clean.

---

## Checkpoint 4: Engine and order-path integration

### Task 9: `engine.ts` — wire enrichment, primary closed/stale filtering, and confirmation fetch

**Files:**
- Modify: `lib/trading-signals/engine.ts`
- Modify: `lib/trading-signals/types.ts` (additive fields, needed before this compiles)

**Interfaces:**
- Consumes: `toClosedSeries` (Task 2), `macd` (Task 5), `bollingerBands` (Task 6), `confirmMultiTimeframe`/`mapWithConcurrency`/`ConfirmationCandles` (Task 7), `applyPhase2Enrichment` (Task 8), `closes` (existing `indicators.ts`).
- Produces: `buildSignalFromCandles(series, generatedAt?, confirmation?: ConfirmationCandles): TradingSignal` — existing 2-argument call sites unaffected; `generateSignals` now fetches primary+1h+1d per symbol, bounded. `TradingSignal.generatedAt` continues to be the sole server-computed clock source; internally parsed once to `analysisNow`.

**Note:** this task replaces the entire file. Read the current file first (required before any Write), then replace it with the content below — the diff touches every function, so a full-file replacement is clearer and less error-prone than a sequence of partial edits.

- [ ] **Step 1: Add additive fields to `lib/trading-signals/types.ts`**

Add before the closing of the file (after the existing `TradingSignal` interface's closing brace, as new top-level exports), and add three new optional fields inside the existing `TradingSignal` interface itself:

Find the end of the `TradingSignal` interface:

```ts
  suggestedEntry?: { low: number; high: number } | null;
  /** Optional diagnostic: the R:R actually observed at the current entry, which MAY be
   *  below MIN_RR. Distinct from riskRewardRatio (which stays null unless actionable). */
  observedRiskReward?: number | null;
}
```

Replace with:

```ts
  suggestedEntry?: { low: number; high: number } | null;
  /** Optional diagnostic: the R:R actually observed at the current entry, which MAY be
   *  below MIN_RR. Distinct from riskRewardRatio (which stays null unless actionable). */
  observedRiskReward?: number | null;
  /** Phase 2 diagnostics — present only on an approved LONG/SHORT signal. */
  macd?: { macdLine: number | null; signalLine: number | null; histogram: number | null };
  bollinger?: { middle: number | null; upper: number | null; lower: number | null; percentB: number | null };
  timeframeConfirmation?: {
    oneHour: "ALIGNED" | "NEUTRAL" | "UNAVAILABLE" | "OPPOSITE";
    oneDay: "ALIGNED" | "NEUTRAL" | "UNAVAILABLE" | "OPPOSITE";
    adjustment: number;
  } | null;
  /** Deterministic, template-generated — never an LLM, never a profit promise.
   *  Present only on an approved LONG/SHORT signal. Confidence is a HEURISTIC
   *  score, not a probability of profit — this field must never claim otherwise. */
  plainLanguageSummary?: string;
}
```

- [ ] **Step 2: Replace `lib/trading-signals/engine.ts` in full**

```ts
// Signal engine orchestration — READ-ONLY, ANALYSIS-ONLY.
//
// Pipeline per symbol: getCandles (public, keyless) -> drop unclosed/stale
// candles -> computeIndicators -> detectSetup -> Phase 2 enrichment (MACD/
// Bollinger/multi-timeframe; confidence + reasoning only, see enrichment.ts) ->
// riskGate -> TradingSignal. The engine PRODUCES OPINIONS ONLY. It imports no
// exchange client and no order/execution path; there is nothing here that can
// place, cancel, size, or manage a live position.
import { getCandles, type CandleSeries } from "@/lib/market-data/candles";
import type { Timeframe, TradingSignal } from "./types";
import {
  CANDLE_LIMIT,
  DEFAULT_TIMEFRAME,
  MAX_CONCURRENT_CANDLE_FETCHES,
  MIN_BARS,
  SUPPORTED_SYMBOLS,
  SYMBOL_WHITELIST,
} from "./config";
import { closes } from "./indicators";
import { computeIndicators, detectSetup } from "./setup";
import { riskGate } from "./risk-gate";
import { toClosedSeries } from "./candle-closed";
import { macd } from "./macd";
import { bollingerBands } from "./bollinger";
import { applyPhase2Enrichment } from "./enrichment";
import {
  confirmMultiTimeframe,
  mapWithConcurrency,
  type ConfirmationCandles,
} from "./multi-timeframe";
import { buildPlainLanguageSummary } from "./explanation";

const WAIT_INVALIDATION =
  "No actionable setup. Re-evaluate on the next closed bar or when a valid R:R setup forms.";

function waitSignal(
  symbol: string,
  timeframe: Timeframe,
  source: "analysis" | "insufficient-data",
  reasoning: string[],
  confidence: number,
  generatedAt: string,
  suggestedEntry: { low: number; high: number } | null = null,
  observedRiskReward: number | null = null,
): TradingSignal {
  return {
    symbol,
    timeframe,
    direction: "WAIT",
    entryZone: null,
    stopLoss: null,
    takeProfit: [],
    riskRewardRatio: null,
    confidence,
    reasoning,
    invalidationCondition: suggestedEntry
      ? `${WAIT_INVALIDATION} Re-evaluate on a pullback toward the suggested entry zone.`
      : WAIT_INVALIDATION,
    generatedAt,
    source,
    suggestedEntry,
    observedRiskReward,
  };
}

/**
 * Pure analysis seam: turn a candle series into a signal. `generatedAt` is the
 * SOLE clock input and is always server-computed at every real call site
 * (generateSignals, SignalEngineStrategy) — no client-supplied timestamp ever
 * reaches this parameter. It is parsed once, internally, into `analysisNow`
 * (epoch ms), which drives every closed-candle/staleness decision below.
 */
export function buildSignalFromCandles(
  series: CandleSeries,
  generatedAt: string = new Date().toISOString(),
  confirmation?: ConfirmationCandles,
): TradingSignal {
  const { symbol, timeframe, candles } = series;
  const analysisNow = Date.parse(generatedAt);

  if (series.source === "insufficient") {
    return waitSignal(
      symbol,
      timeframe,
      "insufficient-data",
      ["No live candles available (provider unreachable or returned nothing). Not fabricating data."],
      0,
      generatedAt,
    );
  }

  const { closedCandles, stale, reason: staleReason } = toClosedSeries(candles, timeframe, analysisNow);
  if (stale || closedCandles.length < MIN_BARS) {
    return waitSignal(
      symbol,
      timeframe,
      "insufficient-data",
      [
        stale
          ? `Primary ${timeframe} data is stale: ${staleReason}`
          : `Only ${closedCandles.length} closed bars available; need ≥ ${MIN_BARS} to analyse.`,
      ],
      0,
      generatedAt,
    );
  }

  const indicators = computeIndicators(closedCandles);
  const rawSetup = detectSetup(indicators);

  const closePrices = closes(closedCandles);
  const macdResult = macd(closePrices);
  const bbResult = bollingerBands(closePrices);
  const confirmationResult = rawSetup
    ? confirmMultiTimeframe(
        confirmation ?? { oneHourCandles: [], oneDayCandles: [] },
        rawSetup.direction,
        analysisNow,
      )
    : null;

  const setup = applyPhase2Enrichment(rawSetup, {
    macd: macdResult,
    bollinger: bbResult,
    confirmation: confirmationResult,
  });
  const gate = riskGate(setup);

  if (!gate.approved || setup === null) {
    return waitSignal(
      symbol,
      timeframe,
      "analysis",
      [...(setup?.reasoning ?? []), ...gate.reasoning],
      setup?.confidence ?? 0,
      generatedAt,
      setup?.suggestedEntry ?? null,
      setup?.observedRiskReward ?? null,
    );
  }

  const lastClose = indicators.lastClose ?? setup.entryZone.high;
  const invalidation =
    setup.direction === "LONG"
      ? `Invalidated on a close below the stop-loss ${setup.stopLoss!.toFixed(2)}.`
      : `Invalidated on a close above the stop-loss ${setup.stopLoss!.toFixed(2)}.`;

  return {
    symbol,
    timeframe,
    direction: setup.direction,
    entryZone: setup.entryZone,
    stopLoss: setup.stopLoss,
    takeProfit: setup.takeProfit,
    riskRewardRatio: setup.riskRewardRatio,
    confidence: setup.confidence,
    reasoning: [
      `Reference price ${lastClose.toFixed(2)} at analysis time.`,
      ...setup.reasoning,
      ...gate.reasoning,
    ],
    invalidationCondition: invalidation,
    generatedAt,
    source: "analysis",
    suggestedEntry: null,
    observedRiskReward: setup.observedRiskReward,
    macd: macdResult,
    bollinger: bbResult,
    timeframeConfirmation: confirmationResult
      ? {
          oneHour: confirmationResult.oneHour,
          oneDay: confirmationResult.oneDay,
          adjustment: confirmationResult.adjustment,
        }
      : null,
    plainLanguageSummary: buildPlainLanguageSummary(
      setup.direction,
      setup.entryZone,
      setup.stopLoss,
      macdResult,
      bbResult,
      confirmationResult,
    ),
  };
}

interface FetchTask {
  symbol: string;
  ticker: string;
  timeframe: Timeframe;
}

/**
 * Generate signals for the requested (whitelisted) symbols in parallel. Unknown
 * symbols are not guessed — they degrade to WAIT/insufficient-data. Never throws.
 * Fetches the primary timeframe plus 1h/1d confirmation for every symbol,
 * bounded to MAX_CONCURRENT_CANDLE_FETCHES concurrent requests per call.
 */
export async function generateSignals(
  symbols: string[] = SUPPORTED_SYMBOLS,
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
): Promise<TradingSignal[]> {
  const generatedAt = new Date().toISOString();

  const tasks: FetchTask[] = [];
  for (const symbol of symbols) {
    const ticker = SYMBOL_WHITELIST[symbol];
    if (!ticker) continue;
    tasks.push({ symbol, ticker, timeframe });
    tasks.push({ symbol, ticker, timeframe: "1h" });
    tasks.push({ symbol, ticker, timeframe: "1d" });
  }

  const fetched = await mapWithConcurrency(tasks, MAX_CONCURRENT_CANDLE_FETCHES, async (task) => ({
    ...task,
    series: await getCandles(task.ticker, task.timeframe, CANDLE_LIMIT),
  }));

  return Promise.all(
    symbols.map(async (symbol): Promise<TradingSignal> => {
      const ticker = SYMBOL_WHITELIST[symbol];
      if (!ticker) {
        return waitSignal(
          symbol,
          timeframe,
          "insufficient-data",
          [`Symbol "${symbol}" is not in the analysis whitelist — not analysed.`],
          0,
          generatedAt,
        );
      }
      const primary = fetched.find((f) => f.symbol === symbol && f.timeframe === timeframe)!.series;
      const oneHour = fetched.find((f) => f.symbol === symbol && f.timeframe === "1h")!.series;
      const oneDay = fetched.find((f) => f.symbol === symbol && f.timeframe === "1d")!.series;

      return buildSignalFromCandles({ ...primary, symbol }, generatedAt, {
        oneHourCandles: oneHour.candles,
        oneDayCandles: oneDay.candles,
      });
    }),
  );
}
```

- [ ] **Step 3: Attempt to run the full test suite (expected to fail — `explanation.ts` doesn't exist yet)**

Run: `npx vitest run`
Expected: FAIL — `engine.ts` imports `./explanation`, which is created in Task 13. This is expected; do not attempt to make the suite green yet. Continue to Task 10, then Task 13 closes this gap before final verification.

- [ ] **Step 4: Create a minimal `lib/trading-signals/explanation.ts` stub to unblock compilation for this task only**

```ts
// TEMPORARY minimal stub — replaced with the full template-based implementation
// in Task 13. Exists now only so engine.ts compiles for Tasks 9–12.
import type { SignalDirection } from "./types";
import type { MacdResult } from "./macd";
import type { BollingerResult } from "./bollinger";
import type { MultiTimeframeResult } from "./multi-timeframe";

export function buildPlainLanguageSummary(
  _direction: SignalDirection,
  _entryZone: { low: number; high: number } | null,
  _stopLoss: number | null,
  _macd: MacdResult,
  _bollinger: BollingerResult,
  _confirmation: MultiTimeframeResult | null,
): string {
  return "";
}
```

This stub is intentionally temporary and is fully replaced (not extended) in Task 13 — flagged here so it is never mistaken for the real implementation.

- [ ] **Step 5: Commit**

```bash
git add lib/trading-signals/types.ts lib/trading-signals/engine.ts lib/trading-signals/explanation.ts
git commit -m "feat(trading-signals): wire Phase 2 enrichment and confirmation fetch into the engine"
```

---

### Task 10: Fix existing fixture timestamps, re-validate the 8 fixtures, add look-ahead regression tests

**Files:**
- Modify: `tests/trading-signals-engine.test.ts`
- Create: `tests/trading-signals-engine-lookahead.test.ts`

**Interfaces:**
- Consumes: `buildSignalFromCandles` (Task 9), `TIMEFRAME_DURATION_MS` (Task 2).
- Produces: nothing new — this task validates and, where necessary, documents intentional output changes in the existing fixture file.

**Why this is necessary (not scope creep):** the existing fixtures' `candlesFromCloses` helper sets `openTime: i` (tiny synthetic indices like 0, 1, 2…), which is incompatible with any real-clock-based staleness check — every fixture would spuriously appear infinitely stale under Task 9's new primary closed/stale filtering. `openTime` was never previously used by any indicator computation (only `close`/`high`/`low`/`volume` are), so fixing it to realistic epoch-ms values changes nothing about the existing fixtures' *tested* behavior — it only makes them pass the new gate that didn't exist before.

- [ ] **Step 1: Fix the timestamp helper in `tests/trading-signals-engine.test.ts`**

Find:

```ts
const AT = "2026-07-13T00:00:00.000Z";
const WIGGLE = 0.5;
```

Replace with:

```ts
import { TIMEFRAME_DURATION_MS } from "@/lib/trading-signals/candle-closed";

const AT = "2026-07-13T00:00:00.000Z";
const AT_MS = Date.parse(AT);
const FOUR_HOUR_MS = TIMEFRAME_DURATION_MS["4h"];
const WIGGLE = 0.5;
```

Find:

```ts
function candlesFromCloses(closes: number[], lastVolumeHigh: boolean): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const isLast = i === closes.length - 1;
    return {
      openTime: i,
      open,
      high: Math.max(open, close) + WIGGLE,
      low: Math.min(open, close) - WIGGLE,
      close,
      volume: isLast && lastVolumeHigh ? 500 : 100,
    };
  });
}
```

Replace with:

```ts
function candlesFromCloses(closes: number[], lastVolumeHigh: boolean): Candle[] {
  // openTime is realistic (spaced by the 4h timeframe, ending exactly when the
  // last candle closes at AT_MS) so Phase 2's closed/stale filtering treats
  // these fixtures as a normal live series. openTime is not read by any
  // indicator computation (only close/high/low/volume are), so this changes
  // nothing about what these fixtures test — only whether they pass the gate.
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const isLast = i === closes.length - 1;
    return {
      openTime: AT_MS - (closes.length - i) * FOUR_HOUR_MS,
      open,
      high: Math.max(open, close) + WIGGLE,
      low: Math.min(open, close) - WIGGLE,
      close,
      volume: isLast && lastVolumeHigh ? 500 : 100,
    };
  });
}
```

- [ ] **Step 2: Run the existing suite and observe the result**

Run: `npx vitest run trading-signals-engine`
Expected: one of two outcomes —
- **(a) All 8 tests still pass.** Multi-timeframe contributes 0 for every fixture (no confirmation data is passed — 2-argument calls, per Task 9's `confirmation ?? { oneHourCandles: [], oneDayCandles: [] }` default), so any output change can only come from MACD/Bollinger. If every fixture's existing assertions (mostly floor/relationship checks like `toBeGreaterThanOrEqual`, `toBe("LONG")`) still hold, no fixture file changes beyond Step 1 are needed. Proceed to Step 4.
- **(b) One or more tests fail.** A specific assertion (most likely a `direction` check crossing the confidence gate, or an exact bound like `confidence >= 55`) no longer holds. Proceed to Step 3.

- [ ] **Step 3 (only if Step 2 found failures): investigate and document each one**

For each failing assertion: temporarily log the fixture's `macd`/`bollinger` diagnostic fields on the returned `TradingSignal` to identify which contributor caused the shift (e.g. `console.log(sig.macd, sig.bollinger)` in the failing test, run once, then remove the log). Update that specific test with:
1. A comment directly above the changed assertion explaining the cause, e.g. `// Phase 2: MACD contradicts this fixture's LONG bias (-10), confidence now 52 < 55 -> WAIT. Was LONG pre-Phase-2 (see pinned baseline in Task 1, which proves detectSetup's own confidence of 50 is unchanged).`
2. The updated assertion reflecting the new, intentional behavior.

Never delete or weaken an assertion to make it pass — only update it to match a documented, understood, intentional new outcome.

- [ ] **Step 4: Run the full engine test file plus the Task 1 baseline together**

Run: `npx vitest run trading-signals-engine trading-signals-detect-setup-baseline`
Expected: PASS — the baseline test (Task 1) proves `detectSetup()` itself produced the same raw confidence/direction it always did; this file's assertions (updated only if Step 3 applied) prove the *final* signal is either unchanged or intentionally, explainably different.

- [ ] **Step 5: Write the look-ahead-bias regression tests**

```ts
// tests/trading-signals-engine-lookahead.test.ts
import { describe, it, expect } from "vitest";
import { buildSignalFromCandles } from "@/lib/trading-signals/engine";
import { TIMEFRAME_DURATION_MS } from "@/lib/trading-signals/candle-closed";
import type { Candle, CandleSeries } from "@/lib/market-data/candles";

const AT = "2026-07-13T00:00:00.000Z";
const AT_MS = Date.parse(AT);
const FOUR_HOUR_MS = TIMEFRAME_DURATION_MS["4h"];
const WIGGLE = 0.5;

function linspace(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1));
  return out;
}

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      openTime: AT_MS - (closes.length - i) * FOUR_HOUR_MS,
      open,
      high: Math.max(open, close) + WIGGLE,
      low: Math.min(open, close) - WIGGLE,
      close,
      volume: i === closes.length - 1 ? 500 : 100,
    };
  });
}

function series(closes: number[]): CandleSeries {
  return { symbol: "BTC/USDT", timeframe: "4h", candles: candlesFromCloses(closes), source: "live", fetchedAt: 0 };
}

function withUnclosedExtreme(base: CandleSeries, extremeClose: number): CandleSeries {
  const forming: Candle = {
    openTime: AT_MS, // opens exactly "now" -> not yet closed at analysisNow=AT_MS
    open: extremeClose,
    high: extremeClose + 10,
    low: extremeClose - 10,
    close: extremeClose,
    volume: 100_000,
  };
  return { ...base, candles: [...base.candles, forming] };
}

describe("look-ahead-bias regression — an unclosed trailing candle must never influence the signal", () => {
  it("uptrend fixture: identical output with or without an extreme unclosed candle appended", () => {
    const closes = [
      ...linspace(100, 170, 64),
      ...linspace(170, 158, 9).slice(1),
      ...linspace(158, 162, 9).slice(1),
    ];
    const base = series(closes);
    const withExtreme = withUnclosedExtreme(base, 500);
    expect(buildSignalFromCandles(withExtreme, AT)).toEqual(buildSignalFromCandles(base, AT));
  });

  it("downtrend fixture: identical output with or without an extreme unclosed candle appended", () => {
    const closes = [
      ...linspace(200, 140, 64),
      ...linspace(140, 152, 9).slice(1),
      ...linspace(152, 148, 9).slice(1),
    ];
    const base = series(closes);
    const withExtreme = withUnclosedExtreme(base, 1);
    expect(buildSignalFromCandles(withExtreme, AT)).toEqual(buildSignalFromCandles(base, AT));
  });
});
```

- [ ] **Step 6: Run to verify**

Run: `npx vitest run trading-signals-engine-lookahead`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add tests/trading-signals-engine.test.ts tests/trading-signals-engine-lookahead.test.ts
git commit -m "test(trading-signals): fix fixture timestamps for closed-candle filtering, add look-ahead regression"
```

---

### Task 11: `SignalEngineStrategy` — order-time confirmation-fetch parity

**Files:**
- Modify: `lib/trading-bot/strategy.ts`
- Modify: `tests/trading-bot-strategy.test.ts`

**Interfaces:**
- Consumes: `getCandles` (existing), `buildSignalFromCandles`'s new optional 3rd parameter (Task 9).
- Produces: no change to the exported `Strategy` interface or `SourceSignal` type — `generateIntent`'s internal fetch behavior only.

- [ ] **Step 1: Modify `lib/trading-bot/strategy.ts`**

Find:

```ts
    const series = await getCandles(ticker, timeframe, CANDLE_LIMIT);

    // Candle-data freshness check
```

Replace with:

```ts
    const series = await getCandles(ticker, timeframe, CANDLE_LIMIT);

    // Candle-data freshness check
```

(No change at this point — the freshness check on the primary series stays exactly as-is.) Find:

```ts
    const signal = buildSignalFromCandles({ ...series, symbol }, new Date().toISOString());
```

Replace with:

```ts
    // Phase 2 parity: fetch the same 1h/1d confirmation data the display path
    // (generateSignals) uses, so order-time re-validation never diverges from
    // what the user was shown. Public Strategy interface and SourceSignal are
    // unchanged — this only affects internal computation.
    const [oneHourSeries, oneDaySeries] = await Promise.all([
      getCandles(ticker, "1h", CANDLE_LIMIT),
      getCandles(ticker, "1d", CANDLE_LIMIT),
    ]);

    const signal = buildSignalFromCandles({ ...series, symbol }, new Date().toISOString(), {
      oneHourCandles: oneHourSeries.candles,
      oneDayCandles: oneDaySeries.candles,
    });
```

- [ ] **Step 2: Run the existing 11 strategy tests to confirm no regression**

Run: `npx vitest run trading-bot-strategy`
Expected: PASS (11 tests, unchanged) — `buildSignalFromCandles` is mocked at the module level in this test file (`vi.mock("@/lib/trading-signals/engine", ...)`), so Phase 2's internal enrichment logic never actually runs in these tests; only the additional `getCandles` calls are new, and the existing `vi.mocked(getCandles).mockResolvedValue(freshSeries())` setup already answers any number of calls with any arguments.

- [ ] **Step 3: Add the parity-proving test**

Append to `tests/trading-bot-strategy.test.ts`:

```ts

describe("SignalEngineStrategy — confirmation-fetch parity", () => {
  it("fetches primary, 1h, and 1d candles before calling buildSignalFromCandles", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries());
    vi.mocked(buildSignalFromCandles).mockReturnValue(longSignal() as never);
    await signalEngineStrategy.generateIntent("user-1", "BTC/USDT:4h", NOW_ISO, new Prisma.Decimal("1"));
    const requestedTimeframes = vi.mocked(getCandles).mock.calls.map((call) => call[1]);
    expect(requestedTimeframes).toEqual(expect.arrayContaining(["4h", "1h", "1d"]));
  });

  it("passes the fetched confirmation candles into buildSignalFromCandles's third argument", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries());
    vi.mocked(buildSignalFromCandles).mockReturnValue(longSignal() as never);
    await signalEngineStrategy.generateIntent("user-1", "BTC/USDT:4h", NOW_ISO, new Prisma.Decimal("1"));
    const call = vi.mocked(buildSignalFromCandles).mock.calls[0];
    expect(call[2]).toEqual(
      expect.objectContaining({ oneHourCandles: expect.any(Array), oneDayCandles: expect.any(Array) }),
    );
  });
});
```

- [ ] **Step 4: Run to verify**

Run: `npx vitest run trading-bot-strategy`
Expected: PASS (13 tests: 11 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add lib/trading-bot/strategy.ts tests/trading-bot-strategy.test.ts
git commit -m "feat(trading-bot): fetch 1h/1d confirmation in SignalEngineStrategy for order-time parity"
```

---

### Task 12: Safety verification — no execution/credential/live-trading capability added

**Files:** none created or modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the existing safety test unmodified**

Run: `npx vitest run trading-signals-safety`
Expected: PASS (2 tests) — `trading-signals-safety.test.ts`'s file-glob (`tsFilesUnder(lib/trading-signals)`) automatically includes every new file from Tasks 2, 5–9, 13 with zero test-file changes. If this fails, a new file introduced an import matching `@/lib/exchanges|order|withdraw|transfer|execute|placeOrder|cancelOrder|leverage` — stop and fix that file; do not weaken this test.

- [ ] **Step 2: Confirm the file count grew as expected (sanity check, not a new assertion)**

Run:

```bash
node -e "const {readdirSync}=require('node:fs');function walk(d){let n=0;for(const e of readdirSync(d,{withFileTypes:true})){if(e.isDirectory())n+=walk(d+'/'+e.name);else if(e.name.endsWith('.ts'))n++;}return n;}console.log(walk('lib/trading-signals'));"
```

Expected: a number ≥ 12 (7 pre-Phase-2 files + `candle-closed.ts`, `macd.ts`, `bollinger.ts`, `multi-timeframe.ts`, `enrichment.ts`, `explanation.ts`) — confirms the safety test's `expect(targets.length).toBeGreaterThanOrEqual(7)` bound is still meaningfully covering the whole directory, not silently scanning zero new files due to a path typo.

- [ ] **Step 3: Manually grep the diff for forbidden strings as a second, independent check**

Run: `git diff --stat main -- lib/trading-signals lib/market-data lib/trading-bot | cat` then `git diff main -- lib/trading-signals lib/market-data lib/trading-bot | grep -iE "MEXC_API|lib/exchanges|withdraw|transfer|leverage|placeOrder|cancelOrder" | cat`
Expected: no output (empty grep result).

- [ ] **Step 4: Report**

No commit for this task (verification only) — record the result in the checkpoint report.

---

**Checkpoint 4 complete when:** Tasks 9–12 committed (Task 12 has no commit); run `npx vitest run` — expect the full suite green except any test relying on `explanation.ts`'s real implementation (Task 13 closes this — the Task 9 stub returns `""`, which no existing test in Tasks 9–12 asserts non-empty on); `npx tsc --noEmit` clean.

---

## Checkpoint 5: UI diagnostics, documentation, and complete verification

### Task 13: `explanation.ts` — real deterministic, template-based `plainLanguageSummary`

**Files:**
- Modify: `lib/trading-signals/explanation.ts` (replaces the Task 9 stub in full)
- Create: `tests/trading-signals-explanation.test.ts`

**Interfaces:**
- Consumes: `SignalDirection` (`types.ts`), `MacdResult` (Task 5), `BollingerResult` (Task 6), `MultiTimeframeResult` (Task 7).
- Produces: `buildPlainLanguageSummary(direction, entryZone, stopLoss, macd, bollinger, confirmation): string` — same signature as the Task 9 stub, so `engine.ts` requires no further changes.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-signals-explanation.test.ts
import { describe, it, expect } from "vitest";
import { buildPlainLanguageSummary } from "@/lib/trading-signals/explanation";

const UNAVAILABLE_MACD = { macdLine: null, signalLine: null, histogram: null };
const UNAVAILABLE_BB = { middle: null, upper: null, lower: null, percentB: null };

describe("buildPlainLanguageSummary", () => {
  it("produces a Hold summary with no price detail when WAIT", () => {
    const summary = buildPlainLanguageSummary("WAIT", null, null, UNAVAILABLE_MACD, UNAVAILABLE_BB, null);
    expect(summary).toContain("Hold");
  });

  it("produces a Buy summary reflecting the actual computed diagnostics", () => {
    const summary = buildPlainLanguageSummary(
      "LONG",
      { low: 99, high: 101 },
      95,
      { macdLine: 1, signalLine: 0.5, histogram: 0.5 },
      { middle: 100, upper: 110, lower: 90, percentB: 0.15 },
      { oneHour: "ALIGNED", oneDay: "ALIGNED", adjustment: 15, reasoning: [] },
    );
    expect(summary).toContain("Buy");
    expect(summary).toContain("MACD bullish");
    expect(summary).toContain("near lower Bollinger Band");
    expect(summary).toContain("1h aligned, 1d aligned");
    expect(summary).toContain("Entry near 100.00");
    expect(summary).toContain("stop at 95.00");
  });

  it("produces a Sell summary for a SHORT direction", () => {
    const summary = buildPlainLanguageSummary(
      "SHORT",
      { low: 199, high: 201 },
      210,
      { macdLine: -1, signalLine: -0.5, histogram: -0.5 },
      { middle: 200, upper: 220, lower: 180, percentB: 0.85 },
      { oneHour: "OPPOSITE", oneDay: "NEUTRAL", adjustment: -15, reasoning: [] },
    );
    expect(summary).toContain("Sell");
    expect(summary).toContain("MACD bearish");
    expect(summary).toContain("near upper Bollinger Band");
    expect(summary).toContain("1h opposite, 1d neutral");
  });

  it("reports MACD/Bollinger/timeframe as unavailable when their inputs are unavailable", () => {
    const summary = buildPlainLanguageSummary("LONG", { low: 99, high: 101 }, 95, UNAVAILABLE_MACD, UNAVAILABLE_BB, null);
    expect(summary).toContain("MACD unavailable");
    expect(summary).toContain("Bollinger unavailable");
    expect(summary).toContain("timeframe confirmation unavailable");
  });

  it("never contains language implying guaranteed or certain profit", () => {
    const summary = buildPlainLanguageSummary(
      "LONG", { low: 99, high: 101 }, 95,
      { macdLine: 1, signalLine: 0.5, histogram: 0.5 },
      { middle: 100, upper: 110, lower: 90, percentB: 0.5 },
      null,
    );
    expect(summary).not.toMatch(/guarantee|certain|promise|sure thing/i);
  });

  it("always describes confidence as heuristic, never as a probability", () => {
    const summary = buildPlainLanguageSummary(
      "LONG", { low: 99, high: 101 }, 95,
      { macdLine: 1, signalLine: 0.5, histogram: 0.5 },
      { middle: 100, upper: 110, lower: 90, percentB: 0.5 },
      null,
    );
    expect(summary.toLowerCase()).toContain("heuristic");
    expect(summary.toLowerCase()).not.toMatch(/probability of profit|win rate|likelihood of profit/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run trading-signals-explanation`
Expected: FAIL — the Task 9 stub returns `""` for every input, none of the `toContain` assertions match.

- [ ] **Step 3: Replace `lib/trading-signals/explanation.ts` in full**

```ts
// Deterministic, template-generated plain-language explanations. NO LLM, no
// free-text generation — every phrase is chosen from a small fixed set based
// on actual computed diagnostic state. Must never invent a market fact or
// imply certainty of profit; confidence is always described as a heuristic.
import type { SignalDirection } from "./types";
import type { MacdResult } from "./macd";
import type { BollingerResult } from "./bollinger";
import type { MultiTimeframeResult } from "./multi-timeframe";

function macdPhrase(macd: MacdResult): string {
  if (macd.macdLine === null || macd.signalLine === null) return "MACD unavailable";
  return macd.macdLine > macd.signalLine ? "MACD bullish" : "MACD bearish";
}

function bollingerPhrase(bb: BollingerResult): string {
  if (bb.percentB === null) return "Bollinger unavailable";
  if (bb.percentB < 0.2) return "near lower Bollinger Band";
  if (bb.percentB > 0.8) return "near upper Bollinger Band";
  return "within Bollinger mid-range";
}

function timeframePhrase(confirmation: MultiTimeframeResult | null): string {
  if (!confirmation) return "timeframe confirmation unavailable";
  return `1h ${confirmation.oneHour.toLowerCase()}, 1d ${confirmation.oneDay.toLowerCase()}`;
}

function actionWord(direction: SignalDirection): "Buy" | "Sell" | "Hold" {
  if (direction === "LONG") return "Buy";
  if (direction === "SHORT") return "Sell";
  return "Hold";
}

export function buildPlainLanguageSummary(
  direction: SignalDirection,
  entryZone: { low: number; high: number } | null,
  stopLoss: number | null,
  macd: MacdResult,
  bollinger: BollingerResult,
  confirmation: MultiTimeframeResult | null,
): string {
  const action = actionWord(direction);
  if (direction === "WAIT" || entryZone === null || stopLoss === null) {
    return "Hold — no actionable setup right now.";
  }
  const entryMid = ((entryZone.low + entryZone.high) / 2).toFixed(2);
  return (
    `${action} — ${macdPhrase(macd)}, ${bollingerPhrase(bollinger)}, ${timeframePhrase(confirmation)}. ` +
    `Entry near ${entryMid}, stop at ${stopLoss.toFixed(2)}. ` +
    "Confidence is a heuristic score, not a probability of profit."
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run trading-signals-explanation`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full suite to confirm the Task 9 stub's removal doesn't break anything**

Run: `npx vitest run`
Expected: PASS — full suite green now that `explanation.ts` has its real implementation.

- [ ] **Step 6: Commit**

```bash
git add lib/trading-signals/explanation.ts tests/trading-signals-explanation.test.ts
git commit -m "feat(trading-signals): replace explanation stub with deterministic template summaries"
```

---

### Task 14: `/trading-bot` UI — display Phase 2 diagnostics

**Files:**
- Modify: `components/trading-bot/TradingBotPageClient.tsx`

**Interfaces:**
- Consumes: the new optional fields on the `/api/trading-signals` response (`macd`, `bollinger`, `timeframeConfirmation`, `plainLanguageSummary`) — no API route code changes needed, `/api/trading-signals` already returns whatever `generateSignals()` produces.

**No automated test** — same limitation as Phase 1 (no component-testing framework in this repo). Verified via Task 15's manual acceptance checklist.

- [ ] **Step 1: Extend the local `TradingSignalDTO` interface and signal rendering**

Find:

```ts
interface TradingSignalDTO {
  symbol: string;
  timeframe: string;
  direction: "LONG" | "SHORT" | "WAIT";
  generatedAt: string;
  confidence: number;
}
```

Replace with:

```ts
interface TradingSignalDTO {
  symbol: string;
  timeframe: string;
  direction: "LONG" | "SHORT" | "WAIT";
  generatedAt: string;
  confidence: number;
  plainLanguageSummary?: string;
  macd?: { macdLine: number | null; signalLine: number | null; histogram: number | null };
  bollinger?: { middle: number | null; upper: number | null; lower: number | null; percentB: number | null };
  timeframeConfirmation?: {
    oneHour: "ALIGNED" | "NEUTRAL" | "UNAVAILABLE" | "OPPOSITE";
    oneDay: "ALIGNED" | "NEUTRAL" | "UNAVAILABLE" | "OPPOSITE";
    adjustment: number;
  } | null;
}
```

Find:

```tsx
        {signals.data?.signals.map((s) => (
          <div key={s.symbol} className="border-t border-border/40 py-2 first:border-t-0">
            <StatLine label={s.symbol} value={`${s.direction} · confidence ${s.confidence}`} />
```

Replace with:

```tsx
        {signals.data?.signals.map((s) => (
          <div key={s.symbol} className="border-t border-border/40 py-2 first:border-t-0">
            <StatLine label={s.symbol} value={`${s.direction} · confidence (heuristic) ${s.confidence}`} />
            {s.plainLanguageSummary ? (
              <p className="mt-1 text-[11px] text-muted-foreground">{s.plainLanguageSummary}</p>
            ) : null}
            {s.timeframeConfirmation ? (
              <p className="mt-1 text-[10px] text-muted-foreground/70">
                Timeframe confirmation: 1h {s.timeframeConfirmation.oneHour.toLowerCase()}, 1d{" "}
                {s.timeframeConfirmation.oneDay.toLowerCase()} ({s.timeframeConfirmation.adjustment >= 0 ? "+" : ""}
                {s.timeframeConfirmation.adjustment})
              </p>
            ) : null}
```

- [ ] **Step 2: Type-check the component in isolation**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/trading-bot/TradingBotPageClient.tsx
git commit -m "feat(trading-bot): display MACD/Bollinger/timeframe diagnostics on /trading-bot"
```

---

### Task 15: Full verification, documentation, and manual acceptance checklist

**Files:**
- Modify: `pixel-office/FEATURE_REGISTRY.md`
- Modify: `pixel-office/ROADMAP.md`
- Create: `docs/superpowers/specs/2026-07-14-trading-bot-phase2-acceptance-checklist.md`

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — every pre-existing test plus every new Phase 2 test.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Re-run the safety verification from Task 12**

Run: `npx vitest run trading-signals-safety`
Expected: PASS (2 tests) — final confirmation after every Phase 2 file exists.

- [ ] **Step 6: Update `pixel-office/FEATURE_REGISTRY.md`**

Add a new subsection under the existing "Trading Bot" entry (after its Phase 1 caveats list), documenting: MACD/Bollinger/multi-timeframe additions, the heuristic-not-probability confidence framing, the corrected closed-candle/staleness rule, in-flight cache dedup, and the `SignalEngineStrategy` parity fix — following the existing entry's honesty-caveat style.

- [ ] **Step 7: Update `pixel-office/ROADMAP.md`**

Add a new `### AI Trading Bot — Phase 2 (Implementation complete; authenticated interactive acceptance pending)` entry (mirroring the exact status-lifecycle pattern used for Phase 1: `## Implementation complete — acceptance pending` section first, moved into `## Completed` only after the acceptance checklist passes). Update the Backlog's "AI Trading Bot Phase 2+" line to remove what Phase 2 now delivers, keeping only Phase 3+ (backtesting, persistence, sandbox/testnet, live trading, security hardening) as still-deferred.

- [ ] **Step 8: Write the manual acceptance checklist**

Create `docs/superpowers/specs/2026-07-14-trading-bot-phase2-acceptance-checklist.md`, mirroring the structure of Phase 1's checklist (`docs/superpowers/specs/2026-07-14-trading-bot-phase1-acceptance-checklist.md`), covering:

1. **Authenticated access** — sign in, navigate to `/trading-bot`, confirm no console errors.
2. **Diagnostics display correctly** — confirm each signal shows `plainLanguageSummary`, and the confidence label reads "confidence (heuristic)" not "probability."
3. **MACD/Bollinger/timeframe detail is present and internally consistent** — spot-check one signal's displayed `plainLanguageSummary` phrases against its numeric confidence (e.g. if the summary says "MACD bullish" and "1h aligned, 1d aligned" for a LONG signal, confidence should reflect the positive contributions).
4. **SHORT remains non-executable** — a `SHORT` signal (if one appears) still shows "not supported in Phase 1," no order control, and attempting to place an order for it is impossible from the UI.
5. **BUY flow still works end-to-end** — place a mock order on a `LONG` signal exactly as in the Phase 1 checklist; confirm it still fills correctly (proves the order pipeline wasn't broken by the confirmation-fetch parity change).
6. **Server restart resets state** — unchanged from Phase 1, re-verify briefly.
7. **Browser console free of unexpected errors** throughout.

Each item states expected result and evidence to capture, matching the Phase 1 checklist's format exactly.

- [ ] **Step 9: Commit**

```bash
git add pixel-office/FEATURE_REGISTRY.md pixel-office/ROADMAP.md docs/superpowers/specs/2026-07-14-trading-bot-phase2-acceptance-checklist.md
git commit -m "docs: record Phase 2 signal analysis in feature registry/roadmap, add acceptance checklist"
```

---

**Checkpoint 5 complete when:** Tasks 13–15 committed; full `npm test` / `tsc --noEmit` / `npm run lint` / `npm run build` clean; manual acceptance checklist document exists and is ready to walk interactively.

## Self-Review

**Spec coverage:** every section of the approved Phase 2 design maps to a task — §4 enrichment boundary → Task 8; §6 MACD → Tasks 4–5; §7 Bollinger → Task 6; §8 multi-timeframe table → Task 7; §9 Strategy parity → Task 11; §10 confidence composition → Task 8; §11 closed/stale (corrected formula) → Task 2, applied to primary in Task 9 and confirmation in Task 7; §12 server-authoritative clock → Task 9; §13 provider caching/dedup → Task 3, bounded fetching → Tasks 7/9; §14 deterministic explanations → Task 13; §16 safety boundary → Task 12; §17/§18 testing/acceptance → all tasks plus Task 15.

**Placeholder scan:** the only intentional placeholder is the Task 9 `explanation.ts` stub, explicitly flagged as temporary and fully replaced (not extended) in Task 13 — this is a deliberate sequencing device to keep `engine.ts` compiling between tasks, not an incomplete deliverable left in the codebase at plan's end.

**Type consistency:** `ConfirmationCandles` (Task 7) is the exact type `buildSignalFromCandles`'s third parameter accepts (Task 9) and what `SignalEngineStrategy` constructs (Task 11). `MacdResult`/`BollingerResult`/`MultiTimeframeResult` (Tasks 5/6/7) match the parameter types of `applyPhase2Enrichment` (Task 8), `buildPlainLanguageSummary` (Task 13), and the new `TradingSignal` fields (Task 9 Step 1) exactly. `TIMEFRAME_DURATION_MS` is exported once, from `candle-closed.ts` (Task 2), and imported (not redefined) everywhere else it's needed (Tasks 7, 9, 10).

---

Plan complete and saved to `docs/superpowers/plans/2026-07-14-trading-bot-phase2-signals.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
