# AI Trading Bot — Phase 3: Deterministic Long-Only Backtesting

**Status: Approved for implementation planning (2026-07-15).**

This specification defines Phase 3 of the AI Trading Bot: a deterministic, auditable,
long-only backtesting system for the accepted Phase 2 signal engine. It does not place
orders, connect to a broker, or enable automation. It has no database persistence. It
reuses the accepted `lib/trading-signals/` engine unmodified for signal generation and
adds a new, isolated `lib/backtest/` deterministic core plus a new, isolated historical
candle-fetch module.

Phase 1 (`docs/superpowers/specs/2026-07-14-trading-bot-phase1-design.md`) and Phase 2
(`docs/superpowers/specs/2026-07-14-trading-bot-phase2-signals-design.md`) are both
**Accepted** and unmodified by this phase.

---

## 1. Context & Scope

### 1.1 What exists today (verified by reading the code, not from memory)

- `lib/trading-signals/` — pure, deterministic, read-only signal pipeline
  (`getCandles` → `toClosedSeries` → `computeIndicators`/`detectSetup` → MACD/Bollinger/
  multi-timeframe enrichment → `riskGate` → `TradingSignal`). Guarded by a static
  import-graph safety test (`tests/trading-signals-safety.test.ts`) that forbids any
  order/withdraw/transfer/execute/leverage/broker import anywhere under the directory
  (+ `lib/market-data/candles.ts` + the signals route).
- `buildSignalFromCandles(series, generatedAt, confirmation?)` (`lib/trading-signals/engine.ts`)
  takes candles and an **injected** `generatedAt` as parameters. It performs no I/O and
  reads no wall clock — every closed-candle/staleness decision derives from the injected
  `analysisNow`. This is the load-bearing fact Phase 3 depends on: this function can be
  called, unmodified, once per simulated bar, with a historical `analysisNow`, to get
  100% signal parity with the live/displayed engine.
- `lib/trading-bot/` — Phase 1's separate, per-user, in-memory paper-trading pipeline
  (`MockBroker`, `store.ts`, `SignalEngineStrategy`). Live-clock-driven
  (`Date.now()`/`randomUUID()`), not deterministic, not reusable for replay.
- `lib/market-data/candles.ts` — public, keyless MEXC klines fetch for the **live**
  signal path. `CANDLE_LIMIT=200`, no `startTime`/`endTime`, a live 60s TTL cache keyed
  by `Date.now()`. Not fit for historical bulk fetch (see §5).

### 1.2 Goals

- Evaluate the accepted signal engine's historical LONG-only performance for a single
  whitelisted symbol over a user-selected date range, deterministically and reproducibly.
- Produce a complete, auditable trade ledger, equity curve, metrics block, and
  buy-and-hold benchmark, returned directly in the API response (no persistence).
- Prevent look-ahead bias, data leakage, and optimistic fill assumptions by construction,
  not by convention.

### 1.3 Non-goals (explicitly out of scope for Phase 3)

- Multi-symbol / portfolio backtesting, parameter sweeps, walk-forward optimization,
  strategy plugins, persisted run history, live trading, broker credentials, margin,
  leverage, executable short selling, background jobs/automation.

---

## 2. Constants Reference

| Constant | Value | Source |
|---|---|---|
| `MIN_RR` | 1.5 | reused from `lib/trading-signals/config.ts` |
| `RISK_PER_TRADE_FRACTION` | 0.005 (0.5%) | new, `lib/backtest/config.ts` |
| `PRIMARY_WARMUP_BARS` | 60 | reused (`MIN_BARS`) |
| `CONFIRMATION_WARMUP_BARS` | 50 | reused (`CONFIRMATION_MIN_BARS`) |
| `spreadBps` (default) | 5 | configurable |
| `slippageBps` (default) | 5 | configurable |
| `feeRate` (default) | 0.001 (0.1%) | matches Phase 1's `MOCK_FEE_RATE` |
| `initialBalance` (default) | 10,000 USDT | matches Phase 1's `PAPER_STARTING_BALANCE_USDT` |
| `MIN_QUANTITY` | 0.00000001 (1e-8) | smallest representable quantity at 8dp |
| `MAX_AFFORDABILITY_ADJUST_STEPS` | 8 | bounded decrement loop, §8.4 |
| `PRIMARY_CONTIGUITY_TOLERANCE_MS` | 0 | exact contiguity required |
| `MAX_REQUESTED_RANGE_DAYS` | 365 | conservative default ceiling |
| `MEXC_PAGE_LIMIT` | 500 | **empirically verified**, §5.1 — not a documented contract |
| `MAX_PAGES_PER_TIMEFRAME` | 20 | covers a 1-year 1h fetch (≈18 pages) with margin |
| `MAX_TOTAL_CANDLES_PER_TIMEFRAME` | 10,000 | `20 × 500`, safety ceiling |
| `HISTORICAL_FETCH_TIMEOUT_MS` | 6,000 | per page, tighter than the live path's 8,000ms |
| `ROUTE_MAX_DURATION_S` | 60 | explicit `vercel.json` override, §9 |
| `INTERNAL_DEADLINE_S` | 55 | 5s margin under the route ceiling |
| `RESPONSE_SIZE_CAP_BYTES` | 2,097,152 (2 MB) | **self-imposed**, §12 — not a platform claim |
| `EQUITY_CHART_MAX_POINTS` | 500 | chart-only downsampling, §12 |

### 2.1 Configuration bounds (server-side allowlist, enforced before any fetch)

| Config field | Allowed range | Rejected as |
|---|---|---|
| `symbol` | one of the Phase 2 whitelist keys (`BTC/USDT`, `ETH/USDT`, `SOL/USDT`) — no arbitrary string | `UNSUPPORTED_SYMBOL` |
| `timeframe` | `"4h"` (primary) only — 1h/1d are confirmation-only, not user-selectable | `UNSUPPORTED_TIMEFRAME` |
| `requestedStart`/`requestedEnd` | span `≥ 1 day`, `≤ MAX_REQUESTED_RANGE_DAYS (365)`, `requestedEnd > requestedStart`, both parseable UTC | `INVALID_DATE_RANGE` / `RANGE_TOO_LARGE` |
| `initialBalance` | `100 ≤ x ≤ 1,000,000` USDT | `INVALID_INITIAL_BALANCE` |
| `feeRate` | `0 ≤ x ≤ 0.01` (0%–1%) | `INVALID_FEE_RATE` |
| `spreadBps` | `0 ≤ x ≤ 100` (0–1%) | `INVALID_SPREAD` |
| `slippageBps` | `0 ≤ x ≤ 100` (0–1%) | `INVALID_SLIPPAGE` |

These bounds are the sweep space for the §8.4 property-style adjustment-loop tests, and
are validated server-side (route layer) before any historical fetch is attempted — the
provider host itself is never user-suppliable (§19).

---

## 3. Reuse Map & Safety Boundary

| Reused unmodified (pure, no I/O, no wall-clock) | Never imported by `lib/backtest/` |
|---|---|
| `indicators.ts`, `setup.ts`, `risk-gate.ts`, `macd.ts`, `bollinger.ts`, `candle-closed.ts`, `multi-timeframe.ts`, `enrichment.ts`, and **`buildSignalFromCandles`** itself, plus the `Candle` type | `getCandles` / any live-fetch module, `lib/trading-bot/mock-broker.ts`, `store.ts`, `strategy.ts`, any broker adapter, credentials, order/execute/transfer/withdraw code |

`lib/backtest/` may import only the pure signal-analysis functions listed above. The
new historical-fetch module (`lib/market-data/historical-candles.ts`, §5) stays entirely
outside `lib/backtest/`'s import graph — it is imported only by the API route, which
composes fetch (network) and `runBacktest` (pure) at the seam. The existing static
import-graph safety test (`tests/trading-signals-safety.test.ts`) is extended with a
second target directory, `lib/backtest/`, scanned under the same forbidden-import regex.

---

## 4. Module Layout

```
lib/backtest/
  config.ts          — RISK_PER_TRADE_FRACTION, spread/slippage/fee defaults, MAX_AFFORDABILITY_ADJUST_STEPS, MIN_QUANTITY
  decimal.ts          — D8()/Q8() helpers, local to this module (not imported from lib/trading-bot), with parity tests against the accepted rounding convention (§8.1)
  candle-window.ts    — decision-bar / tradable-bar classification (§7), warm-up/evaluation boundary derivation
  fills.ts             — spread/slippage formulas, entry validation sequence, exit fill logic (§8, §10)
  sizing.ts            — risk-based position sizing, bounded affordability/risk-cap loop (§8.4)
  simulate.ts          — the per-bar event loop (§6), orchestrates fills.ts + sizing.ts + buildSignalFromCandles
  metrics.ts            — pure metric functions (§11), callable on any equity-curve/trade-ledger prefix
  validate-candles.ts  — malformed/duplicate/conflict/reorder/gap validation (§13)
  benchmark.ts          — buy-and-hold benchmark calculation (§10.6)
  types.ts               — BacktestConfig, BacktestResult, TradeLedgerEntry, EquityPoint, DataQualityReport
  run-backtest.ts        — orchestrator: runBacktest(candles, config) → BacktestResult. Zero I/O. Accepts a `finalize` flag (§9.2).

lib/market-data/historical-candles.ts   — new, isolated. Paginated MEXC fetch (§5), never imported by lib/backtest/.

app/api/trading-bot/backtest/route.ts   — new route. Composes historical-candles.ts (fetch) + run-backtest.ts (compute). AbortSignal threaded through (§9).

app/trading-bot/backtest/page.tsx        — new page (§14).
components/trading-bot/BacktestPageClient.tsx — new component, reuses PageShell/PixelCard/StatLine.
```

---

## 5. Verified MEXC Klines Pagination Contract

**Empirically verified via live, read-only probes against `https://api.mexc.com/api/v3/klines`
during the design session on 2026-07-15.** This is recorded as empirically observed
behavior, **not a documented, contractually-guaranteed limit** — re-verify if production
pagination behavior ever appears inconsistent with what is stated here.

| Property | Verified behavior |
|---|---|
| `startTime`/`endTime` (epoch ms) | Supported. A request with both correctly returns only candles whose open falls in that window, ascending order. |
| `limit` | Honored up to a hard server-side cap of **500 rows per request**. `limit=500`, `limit=1000`, and `limit=2000` all returned exactly 500 rows; `limit=50` returned 50. (This overturns the commonly-assumed 1000/1500-row Binance-family default — do not assume it elsewhere.) |
| Row shape | 8-element positional array `[openTime, open, high, low, close, volume, closeTime, quoteVolume]` — matches the existing `parseRow`'s ≥6-numeric-field contract. |
| Ordering | Ascending by `openTime` in every observed response (the existing defensive re-sort in `candles.ts`'s pattern is reused as a safety net, not load-bearing). |
| Rate-limit headers | None exposed on this public host (checked, absent). The real rate-limit policy is not independently verifiable — every request is treated defensively (timeout + honest failure, no assumed budget). |

### 5.1 Pagination algorithm

```
cursor = fetchStartTime
loop:
  request startTime=cursor, endTime=fetchEndTime, limit=500
  if 0 rows returned:
      if lastKnownRow.openTime + duration is not near fetchEndTime and not near fetch-time "now":
          issue ONE bounded follow-up probe at startTime=cursor, limit=500
          if follow-up also empty: record a genuine gap, stop
          else: resume with the follow-up's rows
      else: stop (reached range end or present)
  validate: page's first row.openTime > previous page's last row.openTime
      (else PAGINATION_OVERLAP_DETECTED — dedupe overlap, warn)
  validate: page is not byte-identical to the previous page
      (else PAGINATION_CURSOR_STUCK — hard error, abort, never loop)
  append rows
  if rows.length < 500: stop (reached range end)
  cursor = lastRow.openTime + duration
  if pageCount >= MAX_PAGES_PER_TIMEFRAME (20): stop, record truncation warning
```

Per-page timeout: 6,000ms. At most one retry per page on network failure only (not on
business-logic conditions) — total attempts per page ≤ 2. The loop itself is always
bounded by `MAX_PAGES_PER_TIMEFRAME`, independent of retries — never an unbounded loop.

### 5.2 Reconciled caps

`MAX_REQUESTED_RANGE_DAYS = 365`. A 1-year run needs ≈2,190 4h-bars (5 pages), ≈365
1d-bars (1 page), and ≈8,760 1h-bars (**18 pages** — the demanding series, sized against
the shared `MAX_PAGES_PER_TIMEFRAME = 20` ceiling with margin). `MAX_TOTAL_CANDLES_PER_TIMEFRAME
= 10,000`. Cross-timeframe fetches run concurrently (reusing `mapWithConcurrency`, bound
6); pagination *within* one timeframe is sequential (each cursor depends on the prior
page's last row).

### 5.3 Post-pagination coverage validation

After merging all pages for a (symbol, timeframe), the assembled array is checked for
coverage against `[fetchStartTime, fetchEndTime)`. Any shortfall — first available row
later than `fetchStartTime`, or last available row earlier than `fetchEndTime` — is
reported as `coverageShortfall {requestedStart, requestedEnd, actualStart, actualEnd}`.
If the shortfall eats into required warm-up or evaluation-range coverage, the run fails
with `INSUFFICIENT_WARMUP_HISTORY` or `INSUFFICIENT_HISTORICAL_DATA`; otherwise it is a
warning only.

---

## 6. Date-Range, Warm-up, and Evaluation Boundary Semantics

All timestamps are UTC epoch-ms, matching candle `openTime` convention. Interval
convention: **`[normalizedStart, normalizedEnd)`** on the *requested* range, refined
below into two distinct bar classifications that correctly cover the full requested
interval (see §6.3 — this corrects an earlier draft that under-counted the final bar).

### 6.1 Normalization

- `TIMEFRAME_DURATION_MS["4h"] = 14,400,000`.
- `normalizedStart = ceil(requestedStart / 14_400_000) × 14_400_000` (round **up** to the
  next-or-same 4h boundary).
- `normalizedEnd = floor(requestedEnd / 14_400_000) × 14_400_000` (round **down**).
- `effectiveEndBoundary = min(normalizedEnd, latestFullyClosedBarBoundary)` — never
  evaluates a still-forming trailing candle (`latestFullyClosedBarBoundary` derived via
  the existing `dropUnclosedTrailing` mechanism against fetch-time "now").

### 6.2 Warm-up (pre-roll)

- Primary candles fetched from `normalizedStart − PRIMARY_WARMUP_BARS(60)×4h` through
  `normalizedEnd`.
- 1h confirmation candles fetched from `normalizedStart − CONFIRMATION_WARMUP_BARS(50)×1h`
  through `normalizedEnd`.
- 1d confirmation candles fetched from `normalizedStart − 50×1d` through `normalizedEnd`.
- MEXC translation: `fetchStartTime = normalizedStart − preRollBars×duration`,
  `fetchEndTime = normalizedEnd − 1` (the `−1ms` prevents receiving a boundary row whose
  open equals `normalizedEnd` itself; since MEXC's `endTime` filters by candle **open**,
  and the final tradable bar's open is always strictly before `normalizedEnd` by
  construction — see §6.3 — this correctly includes the final tradable bar without
  reaching into the next one).
- If warm-up history cannot be fully obtained, the run fails outright:
  `INSUFFICIENT_WARMUP_HISTORY`.

### 6.3 Decision bars vs. tradable/valuation bars (corrected boundary model)

An earlier draft of this section defined evaluation-range membership by a single
`closeTime < normalizedEnd` test applied uniformly, which incorrectly excluded the final
four hours of every run — the last bar's close *equals* `effectiveEndBoundary` and would
fail a strict `<` test even though it must still be valued and (if a position is open)
liquidated there. This is corrected by splitting bar membership into two distinct,
independently-evaluated sets:

- **Decision bar**: `normalizedStart ≤ closeTime(bar) < effectiveEndBoundary`. Step 5
  (signal computation) runs only for decision bars. A decision bar may queue a pending
  entry for its immediate next bar (step 6).
- **Tradable/valuation bar**: `normalizedStart ≤ openTime(bar) < effectiveEndBoundary`
  **and** `closeTime(bar) ≤ effectiveEndBoundary`. Steps 1–4 (pending-entry fill, gap
  exit, intrabar exit, equity mark) run only for tradable/valuation bars.

These sets are not nested. In general every bar in range is both a decision bar and a
tradable bar, **except**: the single bar whose open precedes `normalizedStart` but whose
close lands exactly on it (decision-only — it produces the range's first signal but is
never itself valued/tradable), and the single bar whose close lands exactly on
`effectiveEndBoundary` (tradable-only — it is valued and, if needed, liquidated, but
produces no new signal, since no entry may ever open at or after `effectiveEndBoundary`).

**Worked example** (`normalizedStart = 08:00`, `effectiveEndBoundary = 16:00`):

| Bar | open–close | Decision bar? | Tradable/valuation bar? |
|---|---|:--:|:--:|
| A | 04:00–08:00 | **Yes** (close 08:00 ≥ start) | No (open 04:00 < start) |
| B | 08:00–12:00 | Yes | **Yes** (first tradable bar) |
| C | 12:00–16:00 | No (close 16:00 is not `< 16:00`) | **Yes** (final tradable/valuation bar) |

- Bar A produces the range's first signal (may queue an entry for B) but never appears
  in the equity curve.
- Bar B is the first bar processed by steps 1–4, and the earliest bar a position can
  actually fill on; it also produces its own signal for a possible C entry.
- Bar C is processed by steps 1–4 (gap exit, intrabar exit, final mark, and — if
  `finalize:true` and a position is open — forced `END_OF_TEST` liquidation, all
  occurring at exactly `16:00`). Bar C produces **no** new signal, so no entry can ever
  be queued for a hypothetical bar D whose open (`16:00`) would fall at/after
  `effectiveEndBoundary` — this is enforced structurally (D is never even fetched;
  `fetchEndTime = normalizedEnd − 1` excludes any bar opening at/after `normalizedEnd`)
  and requires no separate runtime check.
- `firstDecisionBar = A`, `firstExecutionBar = B` (the next contiguous bar after A,
  `openTime === A.closeTime`), `finalTradableBar = C`.
- The equity curve's first point is a synthetic baseline at `normalizedStart` (`08:00`)
  with `equity = initialBalance` — no bar has closed yet; this anchors the first real
  per-bar return (`equity[B.close]/equity[baseline] − 1`). Subsequent points are added at
  the close of every tradable/valuation bar (B, C, ...).
- Benchmark entry mid = `firstExecutionBar.open` = `B.open` (`08:00`) — never
  `firstDecisionBar.open` (`A.open`, `04:00`), which would predate the requested range.
  Benchmark exit = `finalTradableBar.close` = `C.close` (`16:00`).

**Boundary tests required:** a bar closing exactly at `normalizedStart` is a decision
bar; one closing 1ms earlier is warm-up-only. A bar closing exactly at
`effectiveEndBoundary` is tradable but not a decision bar. A bar opening exactly at
`effectiveEndBoundary` is never fetched, never tradable, never produces a signal. A
trailing not-yet-closed candle at fetch time is dropped entirely by `dropUnclosedTrailing`
before any classification runs. An end-to-end test over a small fixture asserts the full
requested interval's final tradable bar is present in the equity curve and eligible for
`END_OF_TEST` liquidation — i.e. no run silently loses its last bar.

Under this model, the previously-drafted `EVALUATION_RANGE_ENDED` expiry reason is
**provably unreachable**: a decision bar's next bar (its own close) is, by the decision-bar
definition, always strictly before `effectiveEndBoundary`, so a queued entry's execution
bar can never itself land at/after the boundary. It is dropped from the rejection-reason
enum rather than kept as dead code.

---

## 7. Per-Bar Event Loop (strict order)

For each bar `k` (iterated in chronological order), applying only the steps its
classification (§6.3) permits:

1. **Process any pending entry** (queued from the previous decision bar) at this bar's
   open — *tradable bars only*.
2. **Process gap exits** for a position that was already open **entering** this bar —
   *tradable bars only*. Never runs against a position that does not yet exist (see §10.5
   for the entry-bar carve-out).
3. **Process intrabar stop/TP1 touches** (stop-first if both touched) — *tradable bars
   only*, evaluated against a position open at this point in the sequence (whether
   pre-existing or just opened by step 1 of this same bar).
4. **Mark equity** at this bar's close — *tradable bars only*.
5. **Compute the signal** with `analysisNow = closeTime(bar)` via `buildSignalFromCandles`
   — *decision bars only*.
6. **Queue an eligible entry** for the immediate next bar if the signal is an approved
   LONG and the symbol is flat — *decision bars only*.

Every emitted event (`SIGNAL_COMPUTED`, `ENTRY_PROCESSED`, `GAP_EXIT_PROCESSED`,
`INTRABAR_EXIT_PROCESSED`, `EQUITY_MARKED`) carries a monotonically increasing
`sequenceNumber`, assigned in this emission order. This resolves the case where a
decision bar's close and the next bar's open share the identical timestamp (the normal
case for adjacent fixed-duration candles): the signal event's `sequenceNumber` is always
lower than the following entry event's, even when their timestamps tie. The correctness
invariant is therefore structural, not timestamp-based:

- `entryBarIndex === signalBarIndex + 1`
- `entryBar.openTime === signalBar.openTime + primaryDuration`
- `entryTimestamp >= signalDecisionTimestamp` (non-strict — ties are the normal case)
- The entry event's `sequenceNumber` is strictly greater than the signal event's when
  timestamps tie.
- `entryExecutionPrice` is derived only from `entryBar.open` — structurally never from
  any field of `signalBar`.
- A missing/delayed next bar expires the pending entry (`GAP_BEFORE_ENTRY`); it is never
  deferred to a later, non-contiguous bar.

**Regression test:** three bars where `bar[i].closeTime === bar[i+1].openTime === T`.
Assert (a) a fill using `bar[i+1].open` at timestamp `T` is valid and produces a trade;
(b) the entry price used is always a field of `bar[i+1]`, never any field of `bar[i]`;
(c) the `ENTRY_PROCESSED` sequence number for `bar[i+1]` is strictly greater than the
`SIGNAL_COMPUTED` sequence number for `bar[i]`, despite equal timestamps.

---

## 8. Entry Validation, Fills, and Position Sizing

### 8.1 Scales & rounding

- `D8(x)` — `Prisma.Decimal`, 8 decimal places, `ROUND_HALF_UP`. Applies to every price,
  fee, cash, notional, and P&L value, at the point it becomes an executed/ledger value.
- `Q8(x)` — `Prisma.Decimal`, 8 decimal places, `ROUND_DOWN`. Applies **only** to
  quantity — never rounded up, so a floored quantity's cost can never exceed the budget
  it was sized from.
- Ratios (`netRiskReward`, Sharpe, drawdown, per-bar returns, `actualRiskFraction`) stay
  plain `number`, full precision, rounded only at serialization.
- `D8`/`Q8` are implemented locally in `lib/backtest/decimal.ts` (not imported from
  `lib/trading-bot`), with **parity tests** asserting identical rounding behavior to the
  accepted convention in `lib/trading-bot/mock-broker.ts`'s `rounded()` helper, on a
  shared set of fixture values.

### 8.2 Spread/slippage formulas

Half-spread fraction = `spreadBps/20000`; slippage fraction = `slippageBps/10000`.

```
entryExecutionPrice  = D8( rawEntryMid   × (1 + spreadBps/20000) × (1 + slippageBps/10000) )
stopExecutionPrice   = D8( rawStopMid    × (1 - spreadBps/20000) × (1 - slippageBps/10000) )
targetExecutionPrice = D8( rawTargetMid  × (1 - spreadBps/20000) × (1 - slippageBps/10000) )
```

The same formula shape is applied twice with different raw inputs: once as a
*hypothetical* gate check at entry time (`rawStopMid`/`rawTargetMid` = the signal's own
`stopLoss`/`takeProfit[0].price`), and again as the *actual* exit computation later
(`rawStopMid`/`rawTargetMid` = whichever raw price the real exit actually triggers from —
the level itself, or a gapped-through open, per §10). No intermediate rounding occurs
between the raw `mid` and the final `D8(...)` call, so the spread-then-slippage grouping
order does not change the numeric result (both factors are multiplicative) — the stated
order is for naming clarity (ask/bid derived first, then worsened), not because a
different result would occur.

### 8.3 Complete entry-validation sequence

Context: bar `i` (`signalBar`) produced an approved LONG signal at step 5; a pending
entry is queued for bar `i+1` (`entryBar`), processed at step 1 of that bar.

1. **Contiguity** — `entryBarIndex === signalBarIndex + 1` and
   `entryBar.openTime === signalBar.openTime + primaryDuration` → else `GAP_BEFORE_ENTRY`.
2. **Raw gap-through-stop** — `entryBar.open ≤ signal.stopLoss` → `GAP_THROUGH_STOP`.
3. **Raw gap-through-target** — `entryBar.open ≥ signal.takeProfit[0].price` →
   `GAP_THROUGH_TARGET`.
4. **Raw entry-zone** — `entryBar.open ∉ [entryZone.low, entryZone.high]` →
   `ENTRY_ZONE_MISSED`.
5. **Compute execution price** — `entryExecutionPrice = D8(entryBar.open × (1+spreadBps/20000) × (1+slippageBps/10000))`.
6. **Cost-adjusted entry-zone** — `entryExecutionPrice ∉ [entryZone.low, entryZone.high]`
   → `ENTRY_ZONE_MISSED_AFTER_COSTS` (spread/slippage can push a raw-open-in-zone fill
   outside the approved zone; this catches it).
7. **Ordering** — require `signal.stopLoss < entryExecutionPrice < signal.takeProfit[0].price`
   → else `COST_ADJUSTED_ENTRY_INVALID`.
8. **Hypothetical unit economics** (execution prices are `D8`-rounded; everything
   derived from them for gating purposes stays **full-precision** Decimal — never written
   to the ledger as-is):
   ```
   hypotheticalStopExecutionPrice   = D8( signal.stopLoss           × (1-spreadBps/20000) × (1-slippageBps/10000) )
   hypotheticalTargetExecutionPrice = D8( signal.takeProfit[0].price × (1-spreadBps/20000) × (1-slippageBps/10000) )
   entryFeePerUnitHyp      = entryExecutionPrice.times(feeRate)
   entryCashOutPerUnitHyp  = entryExecutionPrice.plus(entryFeePerUnitHyp)
   stopExitFeePerUnitHyp   = hypotheticalStopExecutionPrice.times(feeRate)
   stopCashInPerUnitHyp    = hypotheticalStopExecutionPrice.minus(stopExitFeePerUnitHyp)
   targetExitFeePerUnitHyp = hypotheticalTargetExecutionPrice.times(feeRate)
   targetCashInPerUnitHyp  = hypotheticalTargetExecutionPrice.minus(targetExitFeePerUnitHyp)
   netRiskPerUnitHyp   = entryCashOutPerUnitHyp.minus(stopCashInPerUnitHyp)
   netRewardPerUnitHyp = targetCashInPerUnitHyp.minus(entryCashOutPerUnitHyp)
   netRiskReward       = netRewardPerUnitHyp.dividedBy(netRiskPerUnitHyp).toNumber()
   ```
9. **Positive risk/reward** — `netRiskPerUnitHyp > 0` → else `NON_POSITIVE_NET_RISK`;
   `netRewardPerUnitHyp > 0` → else `NON_POSITIVE_NET_REWARD`.
10. **Minimum net R:R** — `netRiskReward ≥ MIN_RR (1.5)` → else `REALIZED_RR_BELOW_MINIMUM`.
11. **Risk-sized quantity** — `riskBudget = D8(entryTimeEquity × 0.005)`;
    `riskSizedQuantity = Q8(riskBudget.dividedBy(netRiskPerUnitHyp))`, where
    `entryTimeEquity` = `availableCash` immediately before this entry (equal to equity,
    since the one-position-per-symbol rule guarantees no other position exists at
    sizing time).
12. **Cash-affordable candidate** —
    `cashAffordableQuantity = Q8(availableCash.dividedBy(entryExecutionPrice.times(1+feeRate)))`.
13. **Initial quantity** — `quantity = min(riskSizedQuantity, cashAffordableQuantity)`.
14. **Bounded cash-and-risk adjustment loop** (§8.4) — resolves `quantity` to a value
    satisfying both `entryCost ≤ availableCash` and `actualNetRisk ≤ riskBudget`
    simultaneously, or rejects.
15. **Accept** — position opens: `finalQuantity`, `entryExecutionPrice`; cash debited
    `entryCost`; ledger records `intendedRiskBudget = riskBudget`, `actualNetRisk`,
    `actualRiskFraction`, `cashCapped` (`true` iff `cashAffordableQuantity <
    riskSizedQuantity` was the binding constraint on the pre-loop `quantity`).

Every expiry/rejection reason at every step is logged with the bar timestamp, whether or
not a trade resulted.

### 8.4 Complete actual-accounting formulas and the bounded risk/cash adjustment loop

Actual ledger accounting is always computed from **total executed notional** — never
from a rounded per-unit fee multiplied by quantity:

```ts
// ENTRY
entryNotional = D8(quantity × entryExecutionPrice)
entryFee = D8(entryNotional × feeRate)
entryCost = D8(entryNotional + entryFee)
cashAfterEntry = D8(availableCash - entryCost)

// EXIT (stop, TP1, or END_OF_TEST — same shape, different exitExecutionPrice input)
exitNotional = D8(quantity × exitExecutionPrice)
exitFee = D8(exitNotional × feeRate)
exitProceeds = D8(exitNotional - exitFee)
cashAfterExit = D8(cashBeforeExit + exitProceeds)

realizedPnl = D8(exitProceeds - entryCost)

// HYPOTHETICAL STOP (sizing/risk-gate only — computed once at entry time from the
// signal's own stopLoss; NOT the same value as a real stop exit's exitExecutionPrice,
// which may differ if the real exit gaps through the level)
hypotheticalStopExitNotional = D8(quantity × hypotheticalStopExecutionPrice)
hypotheticalStopExitFee = D8(hypotheticalStopExitNotional × feeRate)
hypotheticalStopExitProceeds = D8(hypotheticalStopExitNotional - hypotheticalStopExitFee)

actualNetRisk = D8(entryCost - hypotheticalStopExitProceeds)
actualRiskFraction = actualNetRisk.dividedBy(entryTimeEquity).toNumber()
```

`D8`/`ROUND_HALF_UP` on `entryNotional` and `entryFee` (and, symmetrically, on the
hypothetical-stop leg) can each round upward by just under `0.5×10⁻⁸`. This means the
naive `Q8(cash/(price×(1+feeRate)))` candidate quantity does not, by itself, guarantee
the *actual rounded* `entryCost` stays affordable, nor that the *actual rounded*
`actualNetRisk` stays within `riskBudget`. Both are enforced by a single bounded
decrement loop that treats **0.5% of equity as a hard maximum, with no tolerance
constant**:

```
quantity = min(riskSizedQuantity, cashAffordableQuantity)     // both Q8-floored
for step in 1..MAX_AFFORDABILITY_ADJUST_STEPS (= 8):
    entryNotional = D8(quantity × entryExecutionPrice)
    entryFee      = D8(entryNotional × feeRate)
    entryCost     = D8(entryNotional + entryFee)

    hypotheticalStopExitNotional = D8(quantity × hypotheticalStopExecutionPrice)
    hypotheticalStopExitFee      = D8(hypotheticalStopExitNotional × feeRate)
    hypotheticalStopExitProceeds = D8(hypotheticalStopExitNotional - hypotheticalStopExitFee)
    actualNetRisk = D8(entryCost - hypotheticalStopExitProceeds)

    if entryCost <= availableCash AND actualNetRisk <= riskBudget:
        accept this quantity; stop
    quantity = quantity - 0.00000001            // one quantity quantum
    if quantity <= 0:
        reject QUANTITY_TOO_SMALL

if the loop exhausts MAX_AFFORDABILITY_ADJUST_STEPS without accepting:
    if entryCost > availableCash:  reject INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE
    else:                           reject RISK_BUDGET_UNREPRESENTABLE
```

Both `entryCost` and `actualNetRisk` scale essentially linearly with `quantity` (before
rounding), so decreasing `quantity` monotonically helps both constraints; the loop is
expected to resolve within 1–2 real iterations for any realistic price, and is formally
bounded at 8 rather than assumed. The accepted invariant is **actual, post-rounding**
`entryCost ≤ availableCash` **and** `actualNetRisk ≤ riskBudget` — never the pre-rounding
algebraic claim, and never a tolerance-widened risk budget.

**Boundary tests required:** (a) `availableCash` set exactly at the point where the
floored candidate quantity's true (unrounded) cost equals `availableCash`, but
`ROUND_HALF_UP` pushes the rounded `entryCost` `10⁻⁸` over — assert the loop decrements
exactly once and `cashAfterEntry ≥ 0`. (b) an equivalent fixture where rounding pushes
`actualNetRisk` `10⁻⁸` over `riskBudget` while cash is otherwise ample — assert the loop
decrements until `actualNetRisk ≤ riskBudget` exactly, with no tolerance applied.

`MAX_AFFORDABILITY_ADJUST_STEPS` stays fixed at **8**. In addition to the two hand-built
boundary fixtures above, a **property-style test suite** exercises the loop across the
full supported-input space: every whitelisted symbol, the allowed `initialBalance` range,
the allowed `feeRate` range, the allowed `spreadBps` range, and the allowed `slippageBps`
range (each swept across its configured min/max/representative-mid values, combined
pairwise rather than as a full cartesian product, to keep the suite fast and
deterministic — no randomness, no property-based/fuzzing library, just an explicit fixed
grid of fixture values). For every combination the test asserts: (1) if no positive
quantity satisfies both constraints within 8 decrements, the run rejects safely
(`QUANTITY_TOO_SMALL`, `INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE`, or
`RISK_BUDGET_UNREPRESENTABLE` — never an unhandled exception, never a silently-invalid
trade); (2) whenever the loop *does* accept, the accepted quantity satisfies both
`entryCost ≤ availableCash` and `actualNetRisk ≤ riskBudget` exactly, with no tolerance.
**`MAX_AFFORDABILITY_ADJUST_STEPS` must not be increased, and no tolerance constant may
be introduced, without a separate, explicit approval** — this is a hard, documented
product decision, not an implementation detail to be tuned freely during coding.

Identical accounting (entry-side only, no risk-budget constraint) is reused for
benchmark sizing (§10.6), including the same property-style sweep.

---

## 9. Runtime, Cancellation, and `finalize`

### 9.1 Runtime budget

Verified from this repo's own deployment record (`docs/deployment.md` §8): **Vercel
plan is Pro, 300s hard function ceiling.** No `functions` entry exists today for any
trading-bot route (only `/api/cron/snapshot` has an explicit override). Rather than rely
on an unstated platform default, `vercel.json` gets an explicit override mirroring the
proven cron pattern:

```json
"functions": {
  "app/api/cron/snapshot/route.ts": { "maxDuration": 60 },
  "app/api/trading-bot/backtest/route.ts": { "maxDuration": 60 }
}
```

Internal deadline: **55s** (5s margin under the route's 60s). Budget: ~40s soft ceiling
for the historical-fetch phase, remainder for the deterministic compute loop (expected
low-seconds given the bar-count caps in §5.2).

### 9.2 Cancellation — documented, not overclaimed

One `AbortSignal` threads from the client's fetch through the API route into every
pagination request, checked between pages. **Cancel reliably stops in-flight and future
historical-data requests immediately.** It does **not** interrupt the synchronous
deterministic compute loop once that phase begins — no mid-loop abort checks are added
for Phase 3 MVP, since capped bar counts keep that phase in the low seconds. The client
simply discards a late response since it already shows "cancelled." This exact wording
is used in the UI copy — Cancel is never described as terminating all server work.

### 9.3 `finalize` flag

`runBacktest(candles, config)` accepts `finalize: boolean` (default `true`). When
`false`, the event loop still runs through every available tradable bar, but the
end-of-test forced-liquidation step (§9 below/§10.6) is skipped — any open position is
reported open, not synthetically closed. This exists primarily as a testing seam for the
future-independence method (§15), and is otherwise unused by the production API route
(which always calls with `finalize: true`).

---

## 10. Exits, Gap Handling, and Forced Liquidation

### 10.1 Stop/TP1 exits

TP1-only full exits — no partial TP1/TP2 scale-out. A position exits 100% on either a
stop or TP1 touch, using the identical `D8(rawMid × (1∓spreadBps/20000) × (1∓slippageBps/10000))`
formula as entry, with `rawMid` = the touched level (or the gap-adjusted open, §10.2).

### 10.2 Gap-through fills

If a bar's `open` has already passed the stop (`open ≤ stopLoss`) or the target
(`open ≥ targetPrice`), the exit fills **at that bar's open** (`rawMid = bar.open`), not
at the stale stop/target level.

### 10.3 Same-candle stop+target ambiguity

Stop-first, always, unconditionally, at every bar — entry bar or any later bar — with no
exceptions.

### 10.4 Entry-bar exit behavior

- After a position fills at the entry bar's open (step 1), that same bar's remaining
  high/low range (steps 2–3) may still trigger a stop or TP1 touch, evaluated over the
  bar's full high/low (a stated simplification — no tick-level path reconstruction).
- If both are touched within that same bar, stop-first applies (§10.3, unchanged).
- If neither is touched, the position remains open; step 4 marks it at that bar's close,
  and normal processing continues at the next bar.

### 10.5 Gap-exit ordering on the entry bar

Step 2 ("process gap exits for an existing position") **must not run against a position
before it exists.** On the entry bar itself, step 2 is a no-op for that position — there
is no "gap" to check, since the position was opened at this very bar's own open, not
carried in from a prior bar. Step 2 applies, from the *following* bar onward, only to a
position that was already open when that bar began. The entry bar's raw open is used
exclusively for the entry fill; it is never simultaneously reinterpreted as a gap-exit
reference price for a pre-existing position on that same bar.

### 10.6 Gap handling for an already-open position

Unlike a fresh entry (which expires outright on any gap, §7/§8.3 step 1), an
**already-open** position may resume evaluation at the next *available* (possibly
non-contiguous) candle's open, using the same conservative gap-fill rule (§10.2), with a
warning attached to that trade's ledger entry (`GAP_RESOLVED_OPEN_POSITION`). This is the
one deliberate asymmetry between entering fresh and managing an existing position.

### 10.7 End-of-test forced liquidation & final-equity convention

At `finalTradableBar` (§6.3), step 4 marks equity normally — an ordinary mark-to-market
point, exactly like every other bar. If `finalize:true` and a position is open after
that bar's normal steps 1–4, the forced liquidation is computed using the same exit
formula (`rawMid = finalTradableBar.close`, bid-side spread + adverse slippage + exit
fee), exit reason `END_OF_TEST`. **The canonical, metrics-facing equity curve contains
exactly one point per bar** — the final bar's point is **replaced**, not duplicated, by
the post-liquidation cash value, avoiding duplicate-return distortion in Sharpe/drawdown.
Full audit detail (entry/exit price, all costs) remains fully visible in the trade
ledger's `END_OF_TEST` entry — replacement affects only the equity-curve series, never
the ledger. `netProfit = finalCanonicalEquity − initialBalance` uses this same single
value. Identical convention applies to the benchmark (§10.8). `warnings[]` explicitly
discloses this as a synthetic, not a real market, exit.

### 10.8 Benchmark calculation (complete, bounded-loop-consistent)

```
benchmarkEntryExecutionPrice = D8( firstExecutionBar.open × (1+spreadBps/20000) × (1+slippageBps/10000) )

// Sizing reuses the SAME bounded-decrement mechanism as §8.4, with availableCash =
// initialBalance and no risk-budget constraint (accept condition is entryCost <=
// availableCash only):
benchmarkQuantity = boundedAffordableQuantity(initialBalance, benchmarkEntryExecutionPrice, feeRate)

benchmarkEntryNotional = D8( benchmarkQuantity × benchmarkEntryExecutionPrice )
benchmarkEntryFee      = D8( benchmarkEntryNotional × feeRate )
benchmarkEntryCost     = D8( benchmarkEntryNotional + benchmarkEntryFee )
benchmarkResidualCash  = D8( initialBalance − benchmarkEntryCost )   // >= 0 by construction

// per-bar mark: benchmarkResidualCash + benchmarkQuantity × bar.close

benchmarkExitExecutionPrice = D8( finalTradableBar.close × (1-spreadBps/20000) × (1-slippageBps/10000) )
benchmarkExitFee            = D8( benchmarkQuantity × benchmarkExitExecutionPrice × feeRate )
benchmarkExitProceeds       = D8( benchmarkQuantity × benchmarkExitExecutionPrice − benchmarkExitFee )
benchmarkFinalCash          = D8( benchmarkResidualCash + benchmarkExitProceeds )
```

Invariant (tested): `benchmarkEntryCost ≤ initialBalance` always. `benchmarkResidualCash`
sits idle for the run's duration — no further deployment, disclosed in the config echo.
The benchmark's equity curve follows the identical one-point-per-bar, replaced-not-duplicated
final-mark convention as the strategy (§10.7), and both closed trades (strategy's
`END_OF_TEST` and the benchmark's own forced exit) are included in closed-trade metrics.

---

## 11. Metrics (precise definitions)

- **Net profit** = final canonical equity − initial balance.
- **Total return** = netProfit / initialBalance.
- **Win rate** = winningClosedTrades / totalClosedTrades. **Loss rate** =
  losingClosedTrades / totalClosedTrades. A trade with `realizedPnl === 0` exactly counts
  in the denominator of both but the numerator of neither (breakeven treatment, applied
  consistently to win rate, loss rate, and expectancy).
- **Profit factor** = grossProfit / grossLoss; `null` with reason `"undefined — no
  losing trades in this run"` if there are zero losing trades — never `Infinity`.
- **Max drawdown** = largest peak-to-trough % decline over the full mark-to-market
  equity curve (close-to-close), explicitly disclosed as **not an intrabar** drawdown
  measure.
- **Sharpe** — per-bar equity returns: `r[t] = equity[t]/equity[t-1] − 1` over the
  evaluation-range equity curve (starting from the synthetic baseline point, §6.3).
  `sharpe = mean(r) / sampleStdev(r) × sqrt(365.25×6)` (sample stdev, divide by N−1;
  `365.25×6` annualizes 4h bars). Risk-free rate = 0 (stated assumption). `null` if
  `N < 2` or `sampleStdev(r) === 0` — never `NaN`/`Infinity`.
- **# trades** = closed trades only (the `END_OF_TEST` synthetic liquidation counts as
  closed; nothing stays "open" once `finalize:true`).
- **Average win** = mean(realizedPnl) over winning trades. **Average loss** = mean of the
  **absolute value** of `realizedPnl` over losing trades, i.e. reported as a **positive
  magnitude** (tested explicitly for this sign convention).
- **Expectancy** = `winRate×avgWin − lossRate×avgLoss` (both rates and both averages as
  defined above), reported in USDT per trade.
- **Equity curve** = ordered `{time, equity}` array, one point per tradable/valuation
  bar plus the synthetic `normalizedStart` baseline (§6.3), always full-resolution
  internally regardless of any display downsampling (§12).
- **Buy-and-hold benchmark** = §10.8, same actual evaluation range and cost model as the
  strategy run.

---

## 12. Result Payload & Output-Size Bounds

Every `BacktestResult` includes: strategy/engine version identifier, symbol, timeframe,
data source (`"MEXC public klines"`), `requestedRange`, `fetchedWarmupRange`,
`actualEvaluationRange` (three distinct ranges, §6.2), candle counts per timeframe, full
config echo (fee/spread/slippage/risk-fraction/initial-balance and all named constants
in effect), `DataQualityReport` (§13), complete trade ledger (entry/exit time, price,
reason, quantity, fees, `realizedPnl`, `netRiskReward`, `actualRiskFraction`,
`cashCapped`), reproducibility metadata (no RNG seed — nothing here is random), the
metrics block (§11), the equity curve, and the buy-and-hold comparison.

**2 MB is a self-imposed serialized-UTF-8-JSON limit** for this API response — not a
platform claim. Measured via actual byte length (`Buffer.byteLength(JSON.stringify(result),
'utf8')`), not character count, since multi-byte UTF-8 characters would otherwise
undercount true size.

- Metrics are always computed from the full-resolution equity curve/trade ledger.
- The response includes the full trade ledger and full audit/diagnostics metadata
  (bounded by trade count / bar count, both small relative to the 2 MB budget), plus a
  chart-only equity curve capped at `EQUITY_CHART_MAX_POINTS = 500` (fixed-stride
  downsampled, always including the first and last point).
- **Phase 3 MVP exports only the complete trade-ledger CSV.** No equity-curve CSV is
  offered or promised, full-resolution or otherwise. The equity curve returned for
  display is the chart-only, ≤500-point series described above; it exists solely to
  render the sparkline (§14) and is not exported.
- On overflow (actual byte length exceeds the cap): return `RESPONSE_TOO_LARGE` — never
  silently truncate the trade ledger or audit metadata to fit.

---

## 13. Historical Data Validation Policy

Applied to the merged, paginated candle array per (symbol, timeframe), before it reaches
`lib/backtest/`:

1. **Parse** — reuse `parseRow`'s numeric-finiteness check; malformed rows dropped,
   counted (`malformedCount`).
2. **OHLC sanity** — reject (drop, `invalidOhlcCount`) any row with `low > high`,
   `open`/`close` outside `[low, high]`, any of open/high/low/close `≤ 0`, or
   `volume < 0`.
3. **Grid validation** — every `openTime` must align to the expected interval grid;
   misaligned rows are rejected as malformed.
4. **Sort** — ascending by `openTime`; if reordering actually occurred, `reordered: true`
   + `reorderCount`, warned.
5. **Duplicate timestamps** — grouped by `openTime`. Byte-identical duplicates collapse
   to one, counted (`exactDuplicateCount`), warned. **Conflicting** duplicates (same
   timestamp, differing OHLCV) **fail the run outright** (`conflictingDuplicateCount`,
   hard error) — never resolved by keeping first or last silently.
6. **Gap detection** — after dedup/sort, any non-contiguous consecutive pair is recorded
   (`gapCount`, `gaps: [{after, before, missingBars}]`) — never interpolated.
7. Output: the validated array + a `DataQualityReport` with all counts reported
   **separately** (`malformedCount`, `invalidOhlcCount`, `exactDuplicateCount`,
   `conflictingDuplicateCount`, `reordered`, `reorderCount`, `gapCount`, `gaps`,
   `coverageShortfall`). If `conflictingDuplicateCount > 0`, the whole run fails.

Interaction with execution: a gap exactly where a **pending entry** would fill →
`GAP_BEFORE_ENTRY` (§8.3 step 1, no execution). A gap while a position is **already
open** → resumed at the next available candle per §10.6, with a warning, never silently
smoothed over.

---

## 14. Minimal UI

`/trading-bot/backtest`, reusing `PageShell`/`PixelCard`/`StatLine`:

- **Config form** — symbol (dropdown, whitelist-only), date range, initial balance, fee
  rate, spread (bps), slippage (bps), pre-filled with the defaults in §2. Inline
  validation before allowing Run (range too large, end before start, unsupported
  symbol).
- **Run/Cancel** — Run disabled while a request is in flight; Cancel aborts the in-flight
  fetch via `AbortSignal`, with the exact, non-overclaiming copy from §9.2. No
  percent-complete progress bar (no server-side progress channel in MVP scope) — a
  spinner/"Running…" state only, stated as a deliberate simplification.
  states: idle → validating → running → done/error/cancelled.
- **Metrics summary card** — the §11 metrics block as `StatLine`s, plus the benchmark
  comparison side-by-side.
- **Equity curve** — no new charting dependency (none exists in the repo today); a small,
  accessible inline SVG sparkline rendering the ≤500-point chart series from §12.
- **Trade ledger** — scrollable table (entry/exit time, price, quantity, fees, P&L, exit
  reason).
- **Assumptions/warnings card** — echoes `DataQualityReport`, `warnings[]`, and standing
  disclaimers (heuristic-confidence language inherited from Phase 2, no execution, the
  synthetic-end-of-test-liquidation disclosure).
- **CSV export** — the complete trade-ledger CSV only, generated client-side from the
  already-fetched JSON response (§12) — no equity-curve CSV, no new endpoint, no
  persistence.

---

## 15. Future-Independence Test Method

An earlier draft compared a run reaching its own natural end (position may stay open)
against a truncated run force-liquidating at an artificial cutoff — a flawed comparison,
since those two runs are expected to differ at the cutoff by design. Corrected method:

- Build two equal-length datasets, byte-identical through cutoff `T`; only candles
  strictly **after** `T` differ. Both cover the same final range (same natural end).
- Run both with `finalize:false` (§9.3) — no synthetic end-of-test exit in either.
- Assert every signal, pending-entry decision, fill, exit, cash state, and equity point
  at timestamp `≤ T` is byte-identical between the two runs.
- Assert `computeMetrics()` called on each run's own equity-curve/trade-ledger sliced to
  `≤ T` produces identical results between the two runs (clean, since neither includes a
  synthetic final entry).
- Test primary, 1h, and 1d perturbations **independently** — each test perturbs only one
  array's post-`T` rows, leaving the other two arrays and everything pre-`T` untouched.
- A separate test proves `finalize` is purely additive: `finalize:true` output equals
  `finalize:false` output plus one manually-applied end-of-test liquidation using that
  run's own final bar.
- A structural test asserts no trade's entry timestamp is ever `<` its triggering
  signal's decision timestamp, and that ties are correctly ordered by `sequenceNumber`
  (§7).

---

## 16. Testing Plan

**Unit:** metrics edge cases (zero losses, flat equity, zero variance, breakeven
treatment); `D8`/`Q8` rounding parity against `lib/trading-bot/mock-broker.ts`'s
convention; the complete entry-validation sequence (§8.3) with one fixture per named
rejection reason; the bounded cash+risk adjustment loop (§8.4) including both boundary
tests and the §2.1/§8.4 property-style sweep across every whitelisted symbol and the
allowed balance/fee/spread/slippage ranges (fixed grid, pairwise combinations, no
fuzzing library); gap-through-stop/target fills; stop-first-on-both-touched; entry-bar exit
ordering (§10.4/§10.5); decision-bar/tradable-bar classification (§6.3) including the
worked three-bar example; benchmark sizing/liquidation (§10.8); data-validation policy
(§13) fixtures for every count category, including the conflicting-duplicate hard
failure.

**Integration:** `runBacktest()` end-to-end against a realistic local fixture with
hand-verified trades; full response-shape assertion; response byte-size measurement
against the 2 MB cap on a large synthetic fixture.

**Invariant (mandatory, un-skippable):** the `finalize:false` future-independence suite
(§15), tested for primary/1h/1d independently; the structural no-look-ahead assertion;
the extended static safety scan covering `lib/backtest/`.

**Manual acceptance:** a real MEXC-backed run through the UI for one whitelisted symbol;
hand-recompute one or two trades from the ledger against the chart; CSV export opens
correctly; Cancel aborts an in-flight fetch (network phase only, per §9.2's documented
scope); an oversized date-range request is rejected cleanly; browser console stays
clean; no execute/broker capability is reachable from this page.

---

## 17. Assumptions

- Symbol/timeframe scope stays within the existing Phase 2 whitelist (`BTC/USDT`,
  `ETH/USDT`, `SOL/USDT`) and the existing 4h primary / 1h+1d confirmation shape.
- `spreadBps` and `slippageBps` remain two separate, independently configurable inputs
  (§8.2) — they are **compounded together into one effective adverse execution price**
  per fill, but are never represented internally or in configuration as a single
  blended/combined knob. No order-book depth modeling, no randomness.
- Risk-free rate = 0 for Sharpe.
- The 2 MB response cap and `EQUITY_CHART_MAX_POINTS = 500` are product choices, not
  independently verified against any platform-imposed body-size limit.
- `MAX_AFFORDABILITY_ADJUST_STEPS = 8` is a documented, conservative round number, not
  empirically tuned against production data yet.

## 18. Unresolved Decisions (non-blocking, deferred to the implementation plan)

- Exact UI copy/validation-error wording.

`MAX_AFFORDABILITY_ADJUST_STEPS = 8` and the CSV export scope (§12/§14) are resolved,
not open — see §21 items 17–19.

---

## 19. Safety Boundary (restated)

`lib/backtest/` may import only the pure signal-analysis functions listed in §3, plus
the `Candle` type. It must never import live candle fetching, `MockBroker`/trading-bot
`store`/`strategy`, any broker adapter, credentials, or order/execute/transfer/withdraw
code. Historical network fetching (`lib/market-data/historical-candles.ts`) stays
entirely outside `lib/backtest/`'s import graph, composed only at the API route. The
existing static import-graph safety test is extended to scan `lib/backtest/` under the
same forbidden-import rule.

---

## 20. Acceptance Criteria

- Every formula in §8 (spread/slippage, hypothetical unit economics, entry validation,
  the bounded cash+risk adjustment loop and its two boundary tests) and §10.8
  (benchmark) implemented exactly as specified.
- `ENTRY_ZONE_MISSED_AFTER_COSTS` distinct from `ENTRY_ZONE_MISSED`; `EVALUATION_RANGE_ENDED`
  is **not** present in the implementation (provably unreachable, §6.3).
- The corrected decision-bar/tradable-bar boundary model (§6.3) implemented exactly,
  with the worked-example boundary tests passing — no run silently loses its final bar.
- The `finalize:false`/`finalize:true` future-independence suite (§15) passes as an
  un-skippable gate, tested for primary/1h/1d independently.
- Final-equity replacement convention (§10.7) — one point per bar, no duplicate-return
  distortion — verified for both the strategy and the benchmark.
- `D8`/`Q8` parity tests against the accepted Phase 1 rounding convention pass.
- Pagination completion checks (§5.1) implemented and tested against the empirically-verified
  MEXC behavior, explicitly labeled empirical, not contractual, in code comments.
- Output-size bounds (§12) enforced; downsampling proven not to affect any metric.
- `lib/backtest/`'s import graph verified forbidden-import-free by the extended static
  safety test — hard gate.
- No persistence, no optimization/sweep, no leverage, no broker/execution/credential
  path anywhere in the new code.
- Full suite/typecheck/lint/build pass; manual acceptance checklist (§16), including a
  real MEXC-backed run, completed by the repository owner before Phase 3 is marked
  accepted.

---

## 21. Resolved Decisions Log

Recorded for audit; each entry reflects a correction made during design review before
this specification was written.

1. TP1-only exits (no partial scale-out).
2. Fully fee-inclusive, cost-adjusted trade P&L and R:R (not the naive raw
   `(TP1−entry)/(entry−stop)` formula).
3. Per-bar (not per-trade) equity returns for Sharpe.
4. No new charting dependency — inline SVG sparkline.
5. `D8`/`Q8` local to `lib/backtest/`, with parity tests against the accepted monetary
   convention.
6. Warm-up/pre-roll strictly separated from the evaluation range; three distinct ranges
   reported.
7. Explicit, strict per-bar event order (§7), with structural (not timestamp-only)
   sequencing for equal-timestamp ties.
8. Entry never blindly fills at next-open — full validation sequence (§8.3), including
   a post-cost entry-zone re-check (`ENTRY_ZONE_MISSED_AFTER_COSTS`).
9. Spread and slippage kept as separate, configurable, always-adverse knobs.
10. Risk-based position sizing (0.5% of equity), replacing an earlier unspecified
    percent-of-cash default; quantity always floored, never ceiled; a hard cap (no
    tolerance) on both cash affordability and risk budget, resolved via a bounded
    decrement loop.
11. Forced end-of-test liquidation for both the strategy and the benchmark, disclosed as
    synthetic; equity-curve final point replaced, not duplicated.
12. Strengthened historical-data validation — conflicting duplicates fail the run;
    exact duplicates collapse with a warning; gaps never interpolated.
13. MEXC's actual pagination contract empirically verified (500-row cap, not 1000+ as
    commonly assumed) before any cap was finalized.
14. Deployment runtime budget resolved from this repo's own deployment record (Vercel
    Pro, 300s ceiling) rather than assumed.
15. Corrected future-independence test method — equal-length perturbed datasets with a
    `finalize:false` seam, not truncation-vs-full comparison.
16. Corrected the final-evaluation-boundary defect that would have silently dropped
    every run's last four hours (§6.3's decision-bar/tradable-bar split).
17. 2 MB response cap and chart-only downsampling reframed as a self-imposed product
    limit, not a platform claim.
18. `spreadBps` and `slippageBps` reconfirmed as two permanently separate configuration
    inputs — compounded into one effective adverse execution price per fill, but never
    represented or configured as a single blended value (§8.2, §17).
19. Phase 3 MVP exports the complete trade-ledger CSV only — no equity-curve CSV, of any
    resolution, is offered or promised (§12, §14).
20. `MAX_AFFORDABILITY_ADJUST_STEPS` fixed at 8, backed by a property-style test sweep
    across every whitelisted symbol and the full allowed balance/fee/spread/slippage
    range (§2.1, §8.4); the bound may not be raised, and no tolerance constant may be
    introduced, without separate explicit approval.
