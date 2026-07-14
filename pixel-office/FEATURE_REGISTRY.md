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

**Status: Implementation complete; authenticated interactive acceptance pending.**
All automated tests/typecheck/lint/build/safety-scan pass; the authenticated browser
workflow (sign-in → BUY → close, etc.) has not yet been exercised by a human. See
`docs/superpowers/specs/2026-07-14-trading-bot-phase1-acceptance-checklist.md`.

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
