# Feature Registry — Pixel Office

A per-feature reference for the shipped surfaces. Each entry states what the feature
does, the route/files that implement it, where its data comes from, and the honest
caveats. "Sprint" indicates when the feature landed.

Legend: **Live** = real data from a real source · **Mock** = simulated / UI-only,
always labelled as such in the UI.

---

## Executive Dashboard — `/executive` (Sprint 5)

Company-wide KPI overview. Server render is a loading gate; all KPIs are composed
**client-side** by polling existing authenticated endpoints.

- **Files:** `app/executive/page.tsx`, `components/executive/ExecutiveDashboardClient.tsx`
- **Data sources (all existing endpoints):**
  - `/api/portfolios` — total value, unrealized PnL, DCA progress toward ฿1,000,000 (**Live**)
  - `/api/company-status` — total/realized PnL, net cashflow, APY, holdings. PnL/APY/cashflow are labelled **mock**; holdings show a live/mock source tag
  - `/api/affiliate` — today's affiliate income in THB/USD + FX rate (**Live/Mock** per source tag)
  - `/api/crypto-prices` — BTC price, combined with holdings for a BTC asset value (**Live/Mock** per source tag)
  - `/api/agents` — workforce headcount per team + error count (**Live**, file-derived)
- **Layout:** responsive KPI grids (1 / 2 / 4 columns) plus a 3-column status row.
- **Refresh:** per-endpoint polling (30–60 s) via `useJsonPoll`, plus a manual refresh button.
- **Caveats:** workforce count is "installed, not running"; mock figures are visibly tagged and never presented as real.

## AI Operations Center — `/operations` (Sprint 5)

Full workforce view of every Claude Code agent found on the host.

- **Files:** `app/operations/page.tsx`, `components/operations/OperationsCenterClient.tsx`
- **Data source:** `/api/agents` only (polled every 30 s).
- **Panels:**
  - Summary strip: total, available, error, project-scope, user-scope, override counts
  - Search filter across name / role / summary / model / tools
  - Team rosters (grouped, with per-agent model, scope, override badge, tools)
  - Error board: agents whose `.md` file failed to parse, with the error
  - Scope / source panel: which directories were read, whether readable, and counts
  - **Activity feed** — the 8 most recently edited agent files, sorted by file mtime
- **Honesty labels:** the activity feed is explicitly **"last edited / แก้ไขไฟล์ล่าสุด"**
  and NOT "running". The status dot means "installed — not currently running" (green)
  or "error" (red). There is no execution telemetry.

## Mission Control — `/mission-control` (Sprint 5)

Real-time-feeling operations board that reuses existing widgets.

- **Files:** `app/mission-control/page.tsx`, `components/mission-control/MissionControlClient.tsx`
- **Panels & provenance:**
  - Live Signals (TV) — `/api/tradingview-webhook`, polled 10 s (**Live** webhook)
  - Market Pulse — `/api/crypto-prices`, polled 45 s (**Live/Mock** per source tag)
  - System Health — per-endpoint live/mock/error status derived from each feed's own source flags
  - Grid Bot & V2 Trading — reuse existing widgets, badged **UI / mock** (there is no exchange grid-bot API); they tick gently client-side only to feel alive
  - Tasks — an honest placeholder: **"no execution log yet"**, NOT fabricated telemetry
- **Caveats:** nothing on this page executes trades or bots; mock panels are labelled and never surfaced as live data.

## Shared UI / infrastructure (Sprint 5)

Additive building blocks used by the three new surfaces.

- `components/ui/PixelCard.tsx` — static pixel-chrome card (no drag), plus:
  - `SourceTag` — live/partial/mock provenance badge
  - `StatLine` — labelled KPI row
- `components/nav/AppNav.tsx` — shared responsive top nav (Office, Executive,
  Operations, Mission Control, Portfolio) with a mobile hamburger menu. The legacy
  office page keeps its own on-canvas ControlBar and does **not** render this nav.
- `components/ui/PageShell.tsx` — scroll-owning shell (`<main className="h-full
  overflow-y-auto">`) required because `<body>` is `overflow-hidden h-full`.
- `lib/use-json-poll.ts` — `useJsonPoll(url, intervalMs)` polling hook. Keeps the
  last good `data` across a transient failure; `error` reflects the latest attempt.

## Navigation integration (Sprint 5)

- One additive **"Views ▾"** launcher added to
  `components/pixel-office/ControlBar.tsx`, linking to the four surfaces
  (Executive, Operations, Mission Control, Portfolio). No existing control was altered.
- `middleware.ts` `isProtectedPage` extended to gate `/executive(.*)`,
  `/operations(.*)`, and `/mission-control(.*)` — the same page-protection mechanism
  already used for `/portfolio`. API routes remain excluded (they self-enforce and
  answer JSON 401, not an HTML redirect).

## `/api/agents` — hardening (Sprint 5)

Endpoint returns the Claude Code agent roster (project + user scope) grouped by
team. Node runtime (reads the filesystem). The `AgentsResponse` contract in
`types/agent.ts` is **unchanged**.

- **Request flow:** `requireUser()` → `enforceRateLimit(userId, "agentsRead")` →
  `getAgentsCached()` (`app/api/agents/route.ts`). Only auth (401) and rate-limit
  (429) errors reach the caller; loading agents is fault-isolated and never throws.
- **TTL cache** — `lib/agents/agents-cache.ts` (`getAgentsCached()`). In-process,
  time-based expiry. TTL via `AGENTS_CACHE_TTL_MS` (default `30000` ms). No manual
  invalidation and deliberately NOT mtime-keyed (in-place edits don't bump directory
  mtime).
- **Per-user rate limiting** — new `"agentsRead"` bucket in `lib/api/rate-limit.ts`,
  keyed on the internal `userId` (never IP), isolated from the existing `write` /
  `providerRead` buckets. Limit via `RATE_LIMIT_AGENTS_MAX` (default `30` requests /
  60 s window; window shared via `RATE_LIMIT_WINDOW_MS`).
- **Never returned:** the body / system prompt of any agent `.md` file.
- **Caveat:** both the cache and the limiter are per serverless instance (module
  memory), not shared across instances.

## Trading Bot — `/trading-bot` (Phase 1)

**Status: Accepted (2026-07-14).** All automated tests/typecheck/lint/build/
safety-scan pass, and the authenticated interactive acceptance checklist
(`docs/superpowers/specs/2026-07-14-trading-bot-phase1-acceptance-checklist.md`)
was completed by the repository owner — all 9 items passed, no unexpected
browser-console errors.

A paper-trading demo built on top of the existing read-only signal engine. **Mock
only** — no real broker, no real money, no persistence. Full design:
`docs/superpowers/specs/2026-07-14-trading-bot-phase1-design.md`.

- **Files:** `app/trading-bot/page.tsx`, `components/trading-bot/TradingBotPageClient.tsx`,
  `lib/trading-bot/**` (types, config, serialize, pricing, freshness, store, broker-types,
  mock-broker, risk-engine, strategy), `app/api/trading-bot/{account,positions,orders,
  positions/close}/route.ts`.
- **Pipeline:** existing `/api/trading-signals` (unmodified) → `SignalEngineStrategy`
  (re-derives the signal server-side, never trusts client-supplied levels) →
  `TradeIntent` → `StubRiskEngine` (4 rules only — stop-loss present, cost ≤ cash,
  position-quantity checks, valid quantity format) → `MockBroker` → `Fill`.
- **Long-only, Phase 1 scope:** BUY only from an actionable `LONG` signal; `SHORT`
  signals are rejected (`UNSUPPORTED_SHORT`); a separate "Close Position" action lets
  a user reduce/fully close an existing position (signal-independent, server-derived
  price/quantity).
- **Data sources:** market data reused from the existing keyless MEXC klines
  (`lib/market-data/candles.ts`) — no new provider, no credentials. Account state
  starts at a fixed `10,000.00 USDT` paper balance (**Mock**, always).
- **Caveats (honest, not defects):**
  - **In-memory, single-process only — NOT deployment-safe, NOT production-ready.**
    `lib/trading-bot/store.ts` holds a module-scoped `Map<userId, MockAccount>`. It
    is a Phase 1 development aid, correct only in a single warm Node process (local
    dev). It is **not safe on serverless/multi-instance deployment** and must not be
    treated as a production data store. State resets on every server restart. No
    database persistence exists yet (Phase 4).
  - Idempotency (duplicate-submission protection) is enforced via a per-user
    in-process lock — protects within one Node process only, not across instances.
  - `StubRiskEngine` implements exactly 4 rules; the full risk engine (daily loss
    limit, drawdown, exposure caps, circuit breakers, kill switch) is Phase 4.
  - No live trading, no broker credentials, no 2FA/live-mode toggle exist anywhere
    in this code — not even a disabled one.
- **Safety test:** `tests/trading-bot-safety.test.ts` statically scans
  `lib/trading-bot/**` and `app/api/trading-bot/**` and fails the suite if any file
  imports `lib/exchanges/*` or references broker credentials / a live-mode identifier.

## Trading Bot — Extended Signal Analysis (Phase 2)

**Status: Accepted (2026-07-14).** All automated tests/typecheck/lint/build/
safety-scan pass, and the authenticated interactive acceptance checklist
(`docs/superpowers/specs/2026-07-14-trading-bot-phase2-acceptance-checklist.md`)
was completed by the repository owner — all 7 items passed, no unexpected
browser-console errors.

Extends the existing `lib/trading-signals/` engine — used by both the
`/trading-signals` display route and `SignalEngineStrategy` (the order path) —
with MACD, Bollinger Bands, and multi-timeframe (1h/1d confirming 4h)
confidence enrichment. Full design:
`docs/superpowers/specs/2026-07-14-trading-bot-phase2-signals-design.md`.

- **Files:** `lib/trading-signals/{macd,bollinger,candle-closed,multi-timeframe,
  enrichment,explanation}.ts` (new), `indicators.ts` (additive `emaSeries()`),
  `engine.ts`/`types.ts`/`config.ts` (extended), `lib/market-data/candles.ts`
  (in-flight request dedup), `lib/trading-bot/strategy.ts` (confirmation-fetch
  parity).
- **Architecture:** enrichment is an additive second pass
  (`applyPhase2Enrichment`), wired between the existing, unmodified
  `detectSetup()` and `riskGate()` — it can change only `confidence` and
  `reasoning`, never direction, entry zone, stop loss, take profit, primary
  target, risk/reward, suggested entry, or quality status. A pinned snapshot
  test (`trading-signals-detect-setup-baseline.test.ts`) proves `detectSetup()`
  itself is untouched.
- **Closed-candle and staleness detection:** every fetched series (primary and
  both confirmation timeframes) has trailing unclosed candles dropped before
  any indicator math runs, and is checked for staleness measured from when the
  *next* candle's close was expected — not from the last candle's own open
  time (a corrected formula; the naive version would falsely flag data stale
  within minutes of a new candle forming). Primary staleness → WAIT.
  Confirmation staleness/unavailability → `UNAVAILABLE`, degrades gracefully,
  never blocks the primary signal.
- **Multi-timeframe confirmation:** an exhaustive 16-state table (1h × 1d ∈
  {ALIGNED, NEUTRAL, UNAVAILABLE, OPPOSITE}) → a confidence adjustment of −15
  (any conflict, applied once even if both timeframes conflict), +15 (both
  aligned), +5 (one aligned), or 0.
- **Confidence is a heuristic score, not a probability of profit** — labeled
  as such everywhere: the UI, `plainLanguageSummary`, and this document. A
  documented, deliberate tradeoff: Phase 2 contributors are appended on top of
  the existing v1 formula rather than rebalancing it, so strong setups cluster
  near the 100-point ceiling.
- **`plainLanguageSummary`:** deterministic, template-generated from actual
  computed diagnostic states — never an LLM, never free text, never a profit
  promise or guarantee (mechanically enforced by a banned-word test).
- **Order-path parity:** `SignalEngineStrategy.generateIntent` now fetches the
  same 1h/1d confirmation data the display path uses, so an order can never
  silently reject for using less information than what the user was shown.
  Its public `Strategy` interface and `SourceSignal` type are unchanged.
- **`SHORT` remains visible but non-executable** — unchanged from Phase 1.
- **Provider request handling:** `lib/market-data/candles.ts` gained in-flight
  request coalescing (a concurrent identical request reuses the same pending
  fetch rather than issuing a duplicate) on top of its existing 60s
  completed-response cache; a failed/timed-out request is always removed from
  the in-flight map. Fetches across a `generateSignals()` cycle (up to 3
  symbols × 3 timeframes) are bounded to `MAX_CONCURRENT_CANDLE_FETCHES=6`
  concurrent requests.
- **Caveats (honest, not defects):** same in-memory/single-process limitation
  as Phase 1 applies to the candle cache — it is a per-instance shield, not a
  distributed guarantee. No backtesting, no persistence, no live trading —
  unchanged from Phase 1.
- **Safety test:** `trading-signals-safety.test.ts`'s existing file-glob
  automatically covers every new Phase 2 file with zero test-file changes.

## Trading Bot — Backtesting (Phase 3)

**Status: Accepted (2026-07-16).** All automated tests/typecheck/lint/build/
safety-scan pass, and the authenticated interactive acceptance checklist
(`docs/superpowers/specs/2026-07-15-trading-bot-phase3-acceptance-checklist.md`)
was completed by the repository owner — all items passed, including
navigation between Trading Bot and Backtest, a real MEXC-backed run,
immutable result/config binding, stale-result clearing after input changes,
client-side validation without unnecessary API requests, hand-verified trade
accounting, CSV validation, cancellation behavior, invalid-input rejection, a
clean application console, and confirmation that no live execution
capability is reachable. Full design:
`docs/superpowers/specs/2026-07-15-trading-bot-phase3-backtesting-design.md`;
implementation plan: `docs/superpowers/plans/2026-07-15-trading-bot-phase3-backtesting.md`.

Deterministic, long-only, single-symbol (4h primary + 1h/1d confirmation),
in-memory backtesting over the accepted Phase 2 signal engine. No live
trading, no persistence, no leverage/margin/executable shorts, no parameter
optimization, no broker/credential access.

- **Files:** `lib/backtest/{types,config,decimal,validate-candles,
  candle-window,fills,sizing,simulate,benchmark,metrics,run-backtest,
  serialize,csv}.ts` (new, all pure/deterministic, zero I/O); 
  `lib/market-data/historical-candles.ts` (new — paginated MEXC klines fetch,
  isolated from `lib/backtest/`); `lib/api/deadline.ts` (new — generic
  timeout-with-fallback race); `app/api/trading-bot/backtest/route.ts` (new);
  `components/trading-bot/BacktestPageClient.tsx` +
  `app/trading-bot/backtest/page.tsx` (new); `lib/api/rate-limit.ts` (additive
  `backtestRun` bucket); `vercel.json` (additive explicit 60s `maxDuration`
  for the route).
- **Reuses the real, unmodified Phase 2 signal engine:** `runBacktest` wires
  `buildSignalFromCandles` in directly as the simulation loop's injected
  `SignalProvider`, called once per decision bar with a historical
  `analysisNow` — the same closed-candle/staleness logic the live engine
  uses, not a re-implementation. A future-independence invariant suite
  (`tests/backtest-future-independence.test.ts`) proves perturbing any
  primary, 1h, or 1d candle strictly after a cutoff time never changes any
  event, trade, or equity point at or before that cutoff.
- **Decision-bar / tradable-bar boundary model:** the final 4h candle whose
  close lands exactly at the effective end boundary is still processed for
  exits, equity marking, and forced liquidation, but never produces a new
  entry signal — a corrected model from the design spec's §6.3, verified
  end-to-end by `tests/backtest-boundary-e2e.test.ts`. A separate regression
  (`tests/backtest-warmup-invariant.test.ts`) proves the per-bar loop's
  evaluation-only iteration never trims the warm-up history handed to the
  signal engine: the first eligible decision bar always receives the full
  60-bar primary pre-roll and the full 50-bar 1h/1d confirmation pre-roll.
- **Risk-based sizing, hard-capped:** every entry is sized to the lesser of
  available cash and a 0.5% risk-budget fraction via a bounded
  cash-and-risk-budget decrement loop (`MAX_AFFORDABILITY_ADJUST_STEPS = 8`,
  no tolerance, hard cap) — reused identically by strategy entries and the
  buy-and-hold benchmark (cash-only mode). Quantity never rounds upward
  (`Q8`, `ROUND_DOWN`); all monetary math uses `Prisma.Decimal` at 8dp with
  `ROUND_HALF_UP` (`D8`); fees are always computed from total executed
  notional, never a rounded per-unit fee times quantity.
- **Execution model:** a signal computed at a decision bar's close can only
  fill at the *next* bar's open — sequence-numbered events resolve the case
  where a signal's close and the next bar's open share the same timestamp,
  structurally (by index), not by timestamp comparison alone. Stop-first
  applies whenever both stop and TP1 are touched intrabar. Spread and
  slippage are always separate configuration inputs, never blended.
- **Empirically-verified MEXC pagination contract:** the public klines
  endpoint caps at 500 rows per page regardless of the requested `limit`,
  confirmed against the live API (not assumed from documentation) in the
  opt-in live test. Pagination is cursor-overlap-deduplicated, hard-fails on
  a byte-identical stuck cursor, retries a page exactly once, and truncates
  at `MAX_PAGES_PER_TIMEFRAME = 20`.
- **API route protections:** `requireUser()` authentication, a dedicated
  `backtestRun` rate-limit bucket (5/min default), zod validation against
  `CONFIG_BOUNDS` with the symbol restricted to the server-side
  `SUPPORTED_SYMBOLS` enum, a 1–365 day range check, and the exchange ticker
  resolved only from the server-side `SYMBOL_WHITELIST` — no request field is
  ever used to build the provider URL. A single shared `AbortController` ties
  the request's own abort signal to a 55s internal deadline
  (`raceWithDeadline`); aborting it propagates into every in-flight and
  future paginated fetch, so a timeout actually stops network I/O. Errors
  route through the existing `toErrorResponse`, which never echoes stack
  traces, request bodies, or financial results to the client.
- **Response shape and size cap:** `.equityCurve`/`.metrics`/`.tradeLedger`
  are always full-resolution; `.equityCurveChart` is downsampled to ≤500
  points for display only and can never feed back into any metric
  calculation. The full JSON response is capped at 2 MB of UTF-8 bytes
  (`Buffer.byteLength`, not string length) as a self-imposed limit, not a
  platform claim.
- **CSV export — trade ledger only:** no equity-curve CSV is offered, at any
  resolution. `tradeLedgerToCsv()` escapes commas/quotes/LF/CR per RFC 4180,
  and additionally neutralizes spreadsheet-formula injection (OWASP CSV
  Injection): any cell whose first character is `=`, `+`, `-`, `@`, a tab, or
  a carriage return gets a leading single quote. This is applied uniformly
  across every column, including legitimate negative numeric fields such as
  `realizedPnl` — a documented, deliberate tradeoff, since CSV carries no
  per-column type information to exempt "numeric" columns safely.
- **Safety boundary:** `lib/backtest/` is scanned by an extended
  `tests/trading-signals-safety.test.ts` and is structurally forbidden from
  importing network/broker/credential/live-execution code,
  `lib/market-data/historical-candles.ts`, or anything under
  `lib/trading-bot/`; any reference to `lib/market-data/candles.ts` must be
  type-only.
- **Live-provider test:** `tests/live/historical-candles.live.test.ts` is
  excluded from the default `npm test` run and requires the explicit opt-in
  `RUN_LIVE_MEXC_TESTS=1` env var. It performs two real, read-only,
  timeout-protected requests against the public MEXC API (a raw single-page
  fetch and an end-to-end paginated fetch) — never runs in CI unless
  explicitly configured.
- **Caveats (honest, not defects):** no persistence — every result is
  computed fresh per request and discarded; no optimization/parameter
  sweep; long-only (no shorts, no leverage/margin); single-symbol per run;
  the in-memory rate limiter has the same per-instance caveat as Phase 1/2's
  candle cache.

## Configuration (environment variables)

New optional variables introduced in Sprint 5 — documented in `.env.example`, all
with sane defaults, safe to leave unset:

| Variable | Optional? | Default | Purpose |
|---|---|---|---|
| `AGENTS_CACHE_TTL_MS` | Yes | `30000` (ms) | TTL for the in-memory `/api/agents` cache |
| `RATE_LIMIT_AGENTS_MAX` | Yes | `30` (per 60 s) | Per-user rate limit for `/api/agents` |

`RATE_LIMIT_AGENTS_MAX` shares the window length set by `RATE_LIMIT_WINDOW_MS`
(default 60000 ms) and can be disabled globally with `RATE_LIMIT_DISABLED=1`, both of
which pre-date Sprint 5.

Trading Bot Phase 1 adds two more, same conventions:

| Variable | Optional? | Default | Purpose |
|---|---|---|---|
| `RATE_LIMIT_TRADING_BOT_READ_MAX` | Yes | `60` (per 60 s) | Per-user limit for `/api/trading-bot/{account,positions}` |
| `RATE_LIMIT_TRADING_BOT_WRITE_MAX` | Yes | `20` (per 60 s) | Per-user limit for `/api/trading-bot/{orders,positions/close}` |

Trading Bot Phase 3 adds one more, same conventions:

| Variable | Optional? | Default | Purpose |
|---|---|---|---|
| `RATE_LIMIT_BACKTEST_MAX` | Yes | `5` (per 60 s) | Per-user limit for `POST /api/trading-bot/backtest` (an expensive, provider-hitting request) |
