# AI Trading Bot — Phase 2 Design (Extended Signal Analysis)

Status: proposed, awaiting approval. Scope: extends the existing
`lib/trading-signals/` engine with MACD, Bollinger Bands, multi-timeframe
confirmation, richer heuristic confidence scoring, and deterministic
plain-language explanations — integrated into Phase 1's `SignalEngineStrategy`
and the `/trading-bot` page. No persistence, no live trading, no broker
credentials, no automation, no leverage/margin/short-execution. Builds on
Phase 1 (accepted 2026-07-14,
`docs/superpowers/specs/2026-07-14-trading-bot-phase1-design.md`).

## 1. Context

`lib/trading-signals/` today: `getCandles` (public, keyless MEXC klines) →
`computeIndicators` (SMA-20/50, EMA-12/26, Wilder RSI-14, Wilder ATR-14,
20-bar volume average, swing high/low) → `detectSetup` (trend bias +
additive 0–100 confidence + stop/target via structure-first-then-ATR/
risk-multiple fallback) → `riskGate` (hard vetoes: missing stop, R:R below
1.5, confidence below 55, quality flags) → `TradingSignal`. Single timeframe
only (`DEFAULT_TIMEFRAME = "4h"`, hardcoded into `generateSignals` and the
route). `lib/trading-bot/strategy.ts` (Phase 1) re-derives this signal
server-side inside `SignalEngineStrategy.generateIntent` before constructing
a `TradeIntent`.

**Confidence formula as it exists today:** base `40`; `+20` if trend
"aligned" (fast/slow SMA gap > 0.2% and price on the trend side of the slow
SMA); RSI band: `+15` supportive / `−10` overbought-or-oversold / `0`
neutral; volume: `+15` above 20-bar average / `+5` below; R:R bonus: `+10` if
≥2, `+5` if ≥1.5. Clamped to `[0,100]`, then hard-gated at `MIN_CONFIDENCE=55`
independent of magnitude above that floor.

**Gaps this design closes:** no "closed candle" concept anywhere (a trailing
still-forming candle can reach indicator math unfiltered); no dedicated unit
tests for `indicators.ts`'s primitives (only indirect coverage via 8
engine-level fixtures); single timeframe only; the candle cache in
`lib/market-data/candles.ts` caches completed responses but does not
coalesce concurrent in-flight identical requests (verified by reading its
source — see §12).

## 2. Goals / Non-goals

**Goals:** MACD and Bollinger Bands as new indicators; multi-timeframe (1h,
1d) confirmation of the 4h primary signal; a documented, testable confidence
composition; deterministic plain-language Buy/Sell/Hold explanations; strict
closed-candle-only calculation with correct staleness detection; bounded,
deduplicated provider fetching; `SignalEngineStrategy.generateIntent` updated
to use the same three-timeframe view as the display so order-time
re-validation never silently diverges from what the user saw.

**Non-goals:** database persistence, backtesting, live trading, broker
credentials, bot automation, leverage/margin, short execution (`SHORT`
remains analysis-only, exactly as Phase 1 built it), generalizing beyond a
4h primary timeframe (the confirmation timeframe set `{1h, 1d}` is hardcoded
to confirm a `4h` primary — not a general N-timeframe framework).

## 3. Backward-compatibility contract

Adopted definition (supersedes any "byte-identical" framing from earlier
discussion):

- Existing public TypeScript contracts remain backward-compatible.
  `buildSignalFromCandles` gains one new **optional** third parameter;
  existing 2-argument call sites (all 8 fixtures in
  `trading-signals-engine.test.ts`, and `generateSignals`'s pre-Phase-2 call
  shape) continue to compile and run unchanged. `TradingSignal` gains only
  optional fields.
- Existing `entryZone`/`stopLoss`/`takeProfit`/`riskRewardRatio`/
  `observedRiskReward`/`suggestedEntry` calculations remain unchanged.
- Existing `detectSetup()` behavior remains unchanged — enforced mechanically
  (§4), not just by convention.
- Confidence, explanation text, and the final `LONG`/`SHORT`/`WAIT` outcome
  **may change intentionally** once enrichment runs, because enrichment can
  legitimately push confidence across the `MIN_CONFIDENCE` gate. This is
  expected, not a regression.
- Any difference between a pre-Phase-2 and post-Phase-2 result for one of the
  8 existing engine fixtures must be individually documented (which
  contributor caused it) and covered by a new assertion proving it is the
  intended behavior — determined during implementation, since it depends on
  actual computed indicator values for those specific fixtures, which cannot
  be predicted from this document alone.
- Existing Phase 1 trading-bot tests remain unchanged, **except** the
  approved `SignalEngineStrategy.generateIntent` confirmation-fetch addition
  (§9), which changes internal behavior but not its public signature or the
  `SourceSignal` type.
- No hidden feature flag, no second production engine. Enrichment is a real,
  always-on part of the pipeline.

## 4. Enrichment boundary — mechanically enforced

```ts
// lib/trading-signals/enrichment.ts
export function applyPhase2Enrichment(
  rawSetup: RawSetup | null,
  extras: EnrichmentInputs,
): RawSetup | null {
  if (rawSetup === null) return null; // no candidate, nothing to promote
  return {
    ...rawSetup,               // direction, entryZone, stopLoss, takeProfit,
                                // primaryTarget, riskRewardRatio,
                                // observedRiskReward, suggestedEntry,
                                // qualityOk — ALL copied through unchanged
    confidence: computeEnrichedConfidence(rawSetup, extras), // §6
    reasoning: [...rawSetup.reasoning, ...enrichmentReasoning(rawSetup, extras)],
  };
}
```

Because only `confidence` and `reasoning` are ever reassigned, and
`riskGate`'s other three veto conditions (`stopLoss === null`,
`riskRewardRatio === null` or `< MIN_RR`, `!qualityOk`) are all determined
before enrichment runs and never touched by it, enrichment's effect surface
is exactly: *setups that `detectSetup` already found valid, quality-ok, and
priced, whose confidence lands near the 55 floor.* It cannot rescue a
missing-stop or poor-R:R veto, and it cannot reverse `direction` (not in its
output surface at all). `WAIT` (`rawSetup === null`) stays `WAIT`.

`applyPhase2Enrichment` is called from `engine.ts`, between the existing
`detectSetup(indicators)` call and the existing `riskGate(setup)` call.

## 5. Module layout

```
lib/trading-signals/
  indicators.ts       — MODIFY (pure addition only): new export emaSeries()
  macd.ts              — NEW: macd() composite (uses emaSeries + closes)
  bollinger.ts          — NEW: bollingerBands() (%B, bands, mean-reversion score)
  candle-closed.ts        — NEW: isClosed / dropUnclosedTrailing / toClosedSeries
  multi-timeframe.ts        — NEW: per-timeframe state + 16-row scoring table
  enrichment.ts               — NEW: applyPhase2Enrichment + confidence composition
  config.ts                     — MODIFY (additive constants only, see §11/§12)
  engine.ts                       — MODIFY: wire enrichment + confirmation fetch
  types.ts                          — MODIFY (additive optional fields only)
lib/market-data/
  candles.ts                        — MODIFY: add in-flight request dedup (§12)
lib/trading-bot/
  strategy.ts                       — MODIFY: fetch confirmation timeframes too (§9)
```

## 6. MACD — exact formula, warm-up, precision

`macdLine = EMA(12) − EMA(26)` computed as a **full series** (not just the
final value), because the signal line needs the MACD line's history to seed
its own EMA:

```ts
// indicators.ts — new export, ema() untouched
export function emaSeries(values: number[], period: number): (number | null)[]
```

Same seed convention as the existing scalar `ema()` (SMA of the first
`period` values, then Wilder-style recurrence forward), but retains every
intermediate value; entries before the seed index are `null`.

```ts
// macd.ts
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
): MacdResult
```

`macdLineSeries[i] = emaFast[i] - emaSlow[i]` wherever both are non-null
(from index `slowPeriod - 1` onward). `signalLine` = scalar `ema()` over the
non-null-compacted `macdLineSeries`, period `signalPeriod`. `histogram =
macdLine - signalLine`.

**Warm-up: 34 closed bars minimum** (26 to seed the slow EMA, +9 more
MACD-line values to seed the signal EMA) — within the existing `MIN_BARS=60`
floor; no change to `MIN_BARS`. Fewer bars → all three fields `null`
("unavailable"), never fabricated.

**Precision:** full IEEE-double throughout; rounding only at display
(`.toFixed()` in reasoning strings), matching the existing convention for
`stopLoss`/`entryZone`. **Test tolerance:** hand-verified fixtures asserted
with `toBeCloseTo(expected, 6)` to absorb harmless floating-point
accumulation without weakening the check.

**Confidence contribution:** `macdLine` on the trend's side of `signalLine`
(matching `direction`) → `+10`; opposite side → `−10`; unavailable → `0`.

## 7. Bollinger Bands — exact formula, semantics, table

New config constants (`config.ts`, additive): `BOLLINGER_PERIOD = 20`,
`BOLLINGER_STDDEV_MULT = 2` — deliberately independent of `smaFast`'s
existing `20`, to avoid silently coupling two unrelated tuning knobs.

`middle = SMA(20)`; `stdev` = population standard deviation of the last 20
closes; `upper/lower = middle ± 2×stdev`; `%B = (close − lower) / (upper −
lower)`. **Warm-up: 20 closed bars**, within `MIN_BARS=60`.

**Semantics, explicit:** this is a **mean-reversion contribution layered on
an otherwise trend-following setup**. It never determines direction —
`direction` is fixed by `detectSetup`'s SMA comparison, untouched by
enrichment (§4). It only asks whether the *already-chosen* direction's entry
is favorably or unfavorably priced right now, mirroring the existing
direction-aware RSI treatment:

| Direction | `%B < 0.2` | `0.2 ≤ %B ≤ 0.8` | `%B > 0.8` |
|---|---|---|---|
| LONG | `+10` (pulled into support) | `0` | `−10` (extended/chasing) |
| SHORT | `−10` (already extended down) | `0` | `+10` (bounced into resistance) |

Thresholds are **strict** (`<` / `>`); `%B` exactly `0.2` or `0.8` is
neutral. `%B` is never clamped — it can go below `0` or above `1` (a strong
candle can close outside its own bands); those values fall further into the
same two buckets, no additional scaling. `stdev = 0` (degenerate flat
closes) or fewer than 20 closes → unavailable (`0` contribution), never a
division by zero.

## 8. Multi-timeframe confirmation — exact state table

Per-timeframe (1h, 1d independently) state, computed from that timeframe's
own closed-and-fresh candles (§11) using the *same* `smaFast(20)`/
`smaSlow(50)` periods, directional bias only (no stop/target/R:R math on
confirmation timeframes):

- `UNAVAILABLE` — insufficient closed bars (< `CONFIRMATION_MIN_BARS = 50`,
  i.e. `INDICATOR_PERIODS.smaSlow`), stale (§11), or provider fetch failed.
- `NEUTRAL` — `smaFast ≈ smaSlow` (no directional bias).
- `ALIGNED` — that timeframe's bullish/bearish bias matches the primary's
  `direction`.
- `OPPOSITE` — bias contradicts the primary's `direction`.

**Rule:** any `OPPOSITE` present → `−15`, applied exactly once regardless of
how many timeframes conflict. Otherwise, count `ALIGNED`: both → `+15`, one
→ `+5`, none → `0`.

| 1h \ 1d | ALIGNED | NEUTRAL | UNAVAILABLE | OPPOSITE |
|---|---|---|---|---|
| **ALIGNED** | +15 | +5 | +5 | −15 |
| **NEUTRAL** | +5 | 0 | 0 | −15 |
| **UNAVAILABLE** | +5 | 0 | 0 | −15 |
| **OPPOSITE** | −15 | −15 | −15 | −15 |

Reasoning text names which timeframe(s) triggered which state (e.g. "1h
confirms uptrend, 1d unavailable — partial confirmation +5"), even though
the numeric adjustment for any `OPPOSITE` case is applied once.

`SHORT` stays visible-but-non-executable, unchanged from Phase 1.

## 9. `SignalEngineStrategy` confirmation-fetch parity (approved change)

**Problem:** if only `generateSignals` (the display path) fetches
confirmation data but `SignalEngineStrategy.generateIntent` (the order path)
does not, a signal shown as actionable (confirmation-boosted above 55) could
silently reject as `NON_ACTIONABLE_SIGNAL` at order time purely because the
order path is using less information — not because anything real changed.

**Resolution (approved):** `generateIntent` now also fetches the `1h`/`1d`
confirmation series (through the same `getCandles`, benefiting from the same
cache — §12) and passes them into `buildSignalFromCandles`'s new optional
third parameter, so order-time re-validation runs through the *identical*
enrichment logic as the display path. This changes `strategy.ts`'s internal
behavior only — its exported `Strategy` interface signature and the
`SourceSignal` type (Phase 1, accepted) are unchanged, per the earlier
decision to keep Phase 2 diagnostics display-only and out of the order
pipeline's data shape.

## 10. Confidence composition

```
confidence = clamp(0, 100,
  v1_score                    // existing detectSetup formula, unchanged
  + macd_adjustment            // §6: +10 / −10 / 0
  + bollinger_adjustment        // §7: +10 / −10 / 0
  + timeframe_adjustment)        // §8: +15 / +5 / 0 / −15
```

No rebalancing of v1's existing weights — appending new contributors risks
more scores clustering at the 100 ceiling for strong setups, a deliberate,
disclosed tradeoff (rebalancing would risk changing the 8 existing fixtures'
asserted values for no operational benefit, since the *gate* at 55 is what
matters, not the exact number above it).

**Heuristic, not probability — mandatory language.** Confidence is a
heuristic score, not a calibrated probability of profit and not a win rate.
UI copy and documentation must say "confidence score (heuristic)" and must
never say "probability," "win rate," or "likelihood of profit." Tests:
clamping at both ends (a maximally-negative-contributor combination → `0`; a
maximally-positive combination → `100`).

## 11. Closed-candle and staleness rules (corrected)

Two distinct, separately-tested concepts. Both take an injected numeric
`now`, sourced only as described in §13 (never client input).

```ts
// candle-closed.ts
function isClosed(candle: Candle, timeframe: Timeframe, now: number): boolean {
  return now >= candle.openTime + TIMEFRAME_DURATION_MS[timeframe];
}

function dropUnclosedTrailing(candles: Candle[], timeframe: Timeframe, now: number): Candle[] {
  let end = candles.length;
  while (end > 0 && !isClosed(candles[end - 1], timeframe, now)) end--;
  return candles.slice(0, end); // strips ANY number of trailing unclosed candles
}

export interface ClosedSeriesResult {
  closedCandles: Candle[];
  stale: boolean;
  reason?: string;
}

export function toClosedSeries(candles: Candle[], timeframe: Timeframe, now: number): ClosedSeriesResult {
  const closed = dropUnclosedTrailing(candles, timeframe, now);
  const last = closed[closed.length - 1];
  if (!last) return { closedCandles: [], stale: true, reason: "no closed candles available" };

  const duration = TIMEFRAME_DURATION_MS[timeframe];
  const nextExpectedCloseTime = last.openTime + 2 * duration; // when the NEXT candle should close
  const stale = now - last.openTime > 2 * duration + STALE_GRACE_MS; // equivalently now > nextExpectedCloseTime + grace

  return {
    closedCandles: closed,
    stale,
    reason: stale
      ? `next ${timeframe} candle close was expected by ${new Date(nextExpectedCloseTime).toISOString()}, past the ${Math.round(STALE_GRACE_MS / 60000)}min grace ceiling`
      : undefined,
  };
}
```

`STALE_GRACE_MS = 5 * 60_000` — a new, independently-defined constant in
`lib/trading-signals/config.ts`. Same value as Phase 1's
`CANDLE_STALENESS_GRACE_MS` for consistency, **not imported from it** (local
duplicate, per the earlier-approved decision — `lib/trading-bot/freshness.ts`
is unmodified by this design except where §9 requires it).

**Correctness fix from the prior draft:** staleness is measured from when
the *next* candle's close was expected (`last.openTime + 2×duration`), not
from the last candle's own open time. The prior formula
(`now - last.openTime > duration + grace`) would have marked the latest
closed candle stale only minutes into the next candle's formation — wrong,
since the next candle isn't expected to close for nearly a full `duration`
more.

**Boundary semantics:**
- Immediately after the latest candle closes → not stale.
- Five minutes into the next (still-forming) candle → the forming candle is
  dropped by `dropUnclosedTrailing`; the previous (now-`last`) closed candle
  is **not** stale (this is exactly the bug case the correction fixes).
- Exactly at `nextExpectedCloseTime + grace` → **fresh** (boundary
  inclusive on the fresh side; `stale` uses strict `>`).
- One millisecond past that boundary → **stale**.
- Multiple trailing unfinished candles → `dropUnclosedTrailing`'s `while`
  loop already strips all of them, not just the last one.
- A genuinely stalled feed (many timeframes with no new closed candle) →
  stale, by a wide margin.

Applied identically to `1h`, `4h`, and `1d` — no per-timeframe grace-period
variation.

- **Primary (4h):** `toClosedSeries` first; `stale` or `closedCandles.length
  < MIN_BARS` → unchanged WAIT/insufficient-data path.
- **Confirmation (1h/1d):** same function; `stale` or insufficient →
  `UNAVAILABLE` state (§8), never blocks the primary signal.

**Tests, explicitly separated per the correction:** immediately-after-close;
five-minutes-into-forming-candle (not stale); exactly-at-boundary (not
stale); one-ms-past-boundary (stale); multiple-trailing-unfinished-candles;
genuinely-stalled-feed. The "unfinished candle dropped" case and the
"closed-but-stale" case are two different fixtures, not one.

## 12. Server-authoritative clock

Two independent, non-interchangeable clock concepts exist in the system
after Phase 2 — stated explicitly to prevent confusion:

1. **`observedGeneratedAt`** (Phase 1, unchanged) — client-supplied, used
   *only* to bound how old the signal *instance* the user viewed is
   (`SIGNAL_FRESHNESS_WINDOW_MS` check in `lib/trading-bot/strategy.ts`).
2. **`analysisNow`** (Phase 2, new) — always server-authoritative, drives
   every closed-candle and staleness determination inside
   `buildSignalFromCandles`.

`buildSignalFromCandles`'s existing exported signature is **not** changed
(`generatedAt: string`, second positional parameter) to preserve backward
compatibility with the 8 existing fixtures. Internally, at the top of the
function: `const analysisNow = Date.parse(generatedAt);` — this local,
clearly-named value is threaded into every §11 call. No code path allows a
client-supplied value to reach `generatedAt`: `generateSignals()` computes it
itself (`new Date().toISOString()`, shared across all symbols in one batch);
`SignalEngineStrategy.generateIntent` computes it itself the same way. The
output `TradingSignal.generatedAt` field is the same string, not
independently derived — one server clock read per analysis, not two.

## 13. Provider requests and caching

`lib/market-data/candles.ts`'s existing behavior, verified by reading its
source: a `Map<string, CacheEntry>` keyed `${ticker}:${timeframe}:${limit}`,
TTL `60_000ms`, populated **only after a fetch completes successfully** —
there is **no in-flight request coalescing** today. Two concurrent calls
with identical arguments, before either completes, currently issue two
separate network requests. This is corrected as part of Phase 2 (Phase 2
roughly triples same-instant `getCandles` call volume — primary + 1h + 1d —
making this race meaningfully more likely than before):

```ts
// candles.ts — MODIFY: add in-flight dedup alongside the existing TTL cache
const inFlight = new Map<string, Promise<CandleSeries>>();

export async function getCandles(symbol, timeframe, limit): Promise<CandleSeries> {
  const key = cacheKey(symbol, timeframe, limit);
  const cached = candleCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) { /* existing return */ }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = fetchAndCache(symbol, timeframe, limit, key)
    .finally(() => { inFlight.delete(key); }); // unconditional cleanup, success or failure
  inFlight.set(key, promise);
  return promise;
}
```

`fetchAndCache` is the existing fetch-and-`candleCache.set` logic, extracted
unchanged. A failed/timed-out fetch is **never** written to `candleCache`
(already true today — the `insufficient(...)` return paths never call
`candleCache.set`) and is removed from `inFlight` unconditionally via
`.finally()`, so a failure never leaves a stuck pending entry.

- **Cache keys** already include symbol, timeframe, and limit (confirmed
  from source) — unchanged.
- **Bounded parallel fetching:** a `mapWithConcurrency(items, limit, fn)`
  helper local to `multi-timeframe.ts`, capping concurrent in-flight fetches
  per `generateSignals()` call at `MAX_CONCURRENT_CANDLE_FETCHES = 6` (today's
  worst case is 3 symbols × 3 timeframes = 9; the cap keeps this bounded as
  `SUPPORTED_SYMBOLS` potentially grows).
- **Timeout:** inherited unchanged — every fetch already has an 8s
  `AbortController` timeout in `candles.ts`.
- **Partial failure:** a failed/timed-out confirmation fetch → `UNAVAILABLE`
  state (§8), never throws, never blocks the primary signal.
- **No database, no background job** — confirmed, nothing added.
- **Test requirement:** a *concurrent* identical-request test (firing two
  `getCandles` calls via `Promise.all` with identical args while spying on
  the underlying `fetch`), asserting exactly one network call — not only the
  existing sequential-cache-hit style of test.

## 14. Deterministic plain-language explanations

New optional `TradingSignal.plainLanguageSummary: string` field, built from
small template functions per contributor (e.g. `macdPhrase(state): "MACD
bullish" | "MACD bearish" | "MACD unavailable"`), concatenated — **no LLM,
no free text generation**. Must reflect only the actual computed diagnostic
states, never invent a market fact, never promise or imply certainty of
profit. Tests assert exact expected substrings for given input states, plus
a mechanical banned-word check (`/guarantee|certain|promise|sure thing/i`
must never match any generated summary) as a safety net beyond convention.

## 15. Buy/Sell/Hold mapping

Unchanged: approved `LONG` → Buy, approved `SHORT` → Sell
(**display/analysis only** — `SignalEngineStrategy` still rejects `SHORT`
before constructing a `TradeIntent`, untouched by this design), `WAIT` →
Hold.

## 16. Safety boundary

`lib/trading-signals/` retains its hard safety invariant unmodified: no
order/withdraw/transfer/execute capability anywhere in its file tree. All
new files (`macd.ts`, `bollinger.ts`, `candle-closed.ts`,
`multi-timeframe.ts`, `enrichment.ts`) live under `lib/trading-signals/`, so
the existing `trading-signals-safety.test.ts` (which globs every `.ts` file
under that directory) automatically covers them with **zero test-file
changes required**. The `candles.ts` in-flight-dedup change adds no new
network destination — still the same keyless public klines host, still no
signing, still no exchange client import.

## 17. Testing plan (prose — exact test code belongs in the implementation plan)

- **`indicators.ts`:** new unit tests for `emaSeries` in isolation (closing
  the pre-existing "no dedicated indicator unit tests" gap).
- **`macd.ts`:** hand-verified fixture(s), `toBeCloseTo(_, 6)`; insufficient-
  bars (< 34) → all-null; a pinned "MACD confirms" and "MACD contradicts"
  case feeding the `+10`/`−10` confidence contribution.
- **`bollinger.ts`:** `%B < 0`, `%B = 0.2` (neutral boundary), `%B = 0.8`
  (neutral boundary), `%B > 1`, `stdev = 0` (unavailable), `< 20` closes
  (unavailable) — both LONG and SHORT direction tables.
- **`candle-closed.ts`:** the six boundary cases from §11, applied to all
  three timeframes at least once.
- **`multi-timeframe.ts`:** representative rows from the 16-combination
  table (at minimum: both aligned, both opposite mapping to a single −15,
  mixed aligned/unavailable, all-neutral), plus a provider-failure-on-one-
  confirmation-timeframe case.
- **`enrichment.ts`:** a `detectSetup()` pinned-baseline regression test
  (proves it is untouched); a test proving `applyPhase2Enrichment` never
  changes `direction`/`entryZone`/`stopLoss`/`takeProfit`/`primaryTarget`/
  `riskRewardRatio`/`qualityOk` for any input; clamping at `0` and `100`.
- **`engine.ts` (integration):** each of the 8 existing fixtures re-asserted
  (documenting any intentional confidence/outcome change with its cause); a
  look-ahead-bias regression test — a series with an extreme-price unclosed
  trailing candle produces output identical to the same series with that
  candle stripped, on ≥2 fixture series.
- **`candles.ts`:** a concurrent identical-request test asserting exactly
  one underlying fetch (§13); existing sequential-cache tests unmodified.
- **`strategy.ts`:** existing 11 tests re-run to confirm no behavior
  regression on the primary-only fields; new test(s) confirming
  `generateIntent` now fetches confirmation data and that a
  confirmation-boosted signal that would fail primary-only re-validation now
  succeeds (proving the parity fix in §9 actually closes the gap it targets).
- **Safety:** existing `trading-signals-safety.test.ts` run unmodified,
  confirmed to include all 5 new files via its existing glob.

## 18. Acceptance criteria

1. `detectSetup()` pinned-baseline regression test passes.
2. Every intentional difference in the 8 existing engine fixtures' output is
   documented and covered by a new assertion.
3. Public TypeScript contracts remain backward-compatible (additive-only
   signature/type changes).
4. Phase 1 safety invariant and long-only execution behavior unchanged;
   safety test passes with zero modification.
5. All six closed/stale boundary cases (§11) pass, as distinct tests.
6. Concurrent-request dedup is tested and passes (§13).
7. `npm test` / `npx tsc --noEmit` / `npm run lint` / `npm run build` all
   clean.
8. Authenticated manual UI acceptance: MACD/Bollinger/timeframe diagnostics
   and `plainLanguageSummary` display correctly on `/trading-bot`, `SHORT`
   remains visibly non-executable, confidence is labeled as a heuristic
   score — same acceptance-checklist discipline as Phase 1.

## 19. Assumptions

- `SUPPORTED_SYMBOLS` and `DEFAULT_TIMEFRAME="4h"` remain exactly as Phase 1
  left them; Phase 2 adds confirmation timeframes `{1h, 1d}` as a fixed pair,
  not a configurable/generalized set.
- The existing `candles.ts` public klines host and request shape are
  unchanged; only the in-flight-dedup behavior (§13) is added.
- `CONFIRMATION_MIN_BARS = 50` (= `INDICATOR_PERIODS.smaSlow`) is
  deliberately lighter than the primary's `MIN_BARS = 60`, since confirmation
  only needs directional bias, not a full setup.
- `STALE_GRACE_MS = 5 * 60_000`, matching Phase 1's grace value for
  consistency but defined independently (local duplicate, approved).
- `MAX_CONCURRENT_CANDLE_FETCHES = 6` is a starting bound, not derived from
  a load test — reasonable given today's 3-symbol, 3-timeframe worst case of
  9 fetches per cycle.

## 20. Unresolved decisions

None remaining — all decisions raised during design review (architecture
option, timeframe-conflict handling, `SourceSignal` reach, timeframe-table
duplication, the stale-candle formula correctness bug, the server-
authoritative clock, and the in-flight cache dedup) are resolved above.
