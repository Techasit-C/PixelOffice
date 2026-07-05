# Architecture: Portfolio Management Module (+ Phase 0 Foundation)

Status: DESIGN ONLY. Nothing here is implemented. This document specifies boundaries and
contracts precisely enough that database-engineer, backend-developer, frontend-developer,
security-engineer, and qa-engineer can build in parallel without colliding.

Author: solution-architect · Target app: `T:\Claude Code\Ai Agent\pixel-office`

---

## 0. Non-standard Next.js caveat (read first)

`pixel-office/AGENTS.md` warns this is **NOT stock Next.js** — "APIs, conventions, and file
structure may all differ." This design leans on several stock App Router behaviors. Each one
below is tagged **[VERIFY-NEXT]** and MUST be confirmed against `node_modules/next/dist/docs/`
before the owning engineer writes code:

- **[VERIFY-NEXT]** Route Handler signature — this repo uses `export async function GET()` /
  `POST()` returning `NextResponse.json(...)` (confirmed in `app/api/crypto-prices/route.ts`,
  `app/api/company-status/route.ts`). Confirm dynamic segment handlers
  (`app/api/portfolios/[id]/route.ts`) receive the `{ params }` context arg the same way.
- **[VERIFY-NEXT]** `middleware.ts` support and its matcher config (needed for auth gating).
- **[VERIFY-NEXT]** Server-side `cookies()` / `headers()` access used by the auth session helper.
- **[VERIFY-NEXT]** Whether Prisma's Node runtime works in these Route Handlers by default or
  whether `export const runtime = "nodejs"` must be declared per handler (Prisma cannot run on
  the Edge runtime with the standard client).

If any tag fails verification, the affected component's contract still holds — only its
implementation mechanism changes.

---

## 1. Objective & Constraints

**Objective.** Add a per-user **Portfolio Management module**: track holdings across US
ETFs/stocks + crypto, record buy/sell/dividend transactions manually, value them live, and
show cost basis, unrealized P&L, allocation %, and **DCA progress toward ฿1,000,000**.

**Verified constraints (from the current repo):**
- Next.js ^15.5.20 App Router, React 19.2.4, TypeScript 5 (strict), Tailwind v4, npm.
- The dashboard (`/`) is **client-only**: `app/page.tsx` → `NoSSR.tsx` (`dynamic(..., { ssr:false })`)
  → `PixelOfficePageClient.tsx`. Widgets are **pure presentational** components fed `data` props;
  the client page polls `/api/*` on intervals (45s crypto/company, 60s affiliate, 10s TV).
- API pattern: `GET()` returns `NextResponse.json`, wrapped in try/catch with a **mock fallback**
  and a `source: "live" | "mock"` marker. Reuse this pattern — do not invent a new one.
- Reusable libs already exist: `lib/coingecko.ts` (`fetchLiveCryptoPrices`), `lib/fx-rate.ts`
  (`fetchUsdToThbRate`). **Reuse both.**
- Path alias `@/*` → project root. Money is currently plain `number` (`types/market.ts` `Quote.price`).
- **No DB, no ORM, no auth, no user model, no test runner, no CI** today.

**Constraints assumed (stated, not silently chosen):** single user or a small trusted team
(the org is one CEO + agent teams); low request volume (personal DCA tracker, not a trading
venue); Vercel-style hosting is the org default per `devops-engineer` mandate.

---

## 2. Component Breakdown & Boundaries

| Component | Single responsibility | Does NOT own |
|---|---|---|
| **DB (Postgres)** | Durable storage of users, portfolios, transactions, price cache | Business math, valuation |
| **Prisma layer** (`lib/db.ts`, `prisma/schema.prisma`) | Typed data access, migrations, connection pooling | HTTP, auth decisions |
| **Auth layer** (`lib/auth.ts`, `middleware.ts`) | Identify the user, gate routes, expose `session.user.id` | Portfolio logic |
| **Portfolio service** (`lib/portfolio/*.ts`) | Cost-basis math, valuation, P&L, allocation, milestone calc | HTTP shape, persistence details |
| **Price provider** (`lib/prices/*.ts`) | Fetch + cache current prices for crypto AND equities; FX | Position math |
| **Route Handlers** (`app/api/portfolios/**`) | HTTP contract, auth scoping, validation, error/mock fallback | Cost-basis math (delegates to service) |
| **Portfolio UI** (`app/portfolio/*`, `components/portfolio/*`) | Render + capture transactions | Fetching auth tokens, DB |
| **Dashboard summary widget** (`components/widgets/PortfolioWidget.tsx`) | One-glance value + milestone % on the pixel office | Full CRUD |

**Boundary rule:** Route Handlers are thin. All money math lives in `lib/portfolio/` so it is
unit-testable **without HTTP or a DB** (pure functions over plain inputs). This is the single
most important boundary for the QA gate.

**Critical data-integrity boundary:** `Transaction` rows are the **source of truth**. `Holding`
is a **derived cache** (current quantity + average cost), recomputed from transactions on every
write. Never let the UI mutate a Holding directly — it only posts Transactions.

---

## 3. Layer A — Phase 0 Foundation

### 3.1 Database: Postgres + Prisma

**Where it lives.**
- **Dev:** local Postgres via Docker (`docker compose` service `db`, port 5432). Rejected local
  native install (per-OS drift; this is a Windows box) and rejected SQLite-for-dev (Prisma
  `Decimal` and Postgres-specific types behave differently — dev/prod parity matters more than
  setup speed here).
- **Prod:** a hosted serverless Postgres (Neon or Vercel Postgres). **Tradeoff:** serverless
  Postgres gives near-zero ops and a generous free tier (fits "งบจำกัด"), but cold starts +
  per-connection limits mean the Prisma client MUST use a pooled connection string
  (`?pgbouncer=true` / Neon pooler) or connections exhaust under the dashboard's polling.

**Connection / env.**
- `DATABASE_URL` (pooled, app runtime) + `DIRECT_URL` (unpooled, migrations only) in `.env`,
  never committed. Add `.env.example` documenting both. This mirrors the existing key-in-env
  convention (`COINGECKO_API_KEY`, `MEXC_API_KEY` in current routes).
- **Prisma client singleton** in `lib/db.ts` guarded by a `globalThis` cache — Next.js dev
  hot-reload otherwise spawns a new client per reload and exhausts connections. **[VERIFY-NEXT]**
  confirm the module-caching behavior in this Next build.

**Migration strategy.**
- Source of truth = `prisma/schema.prisma`. Dev: `prisma migrate dev` (generates SQL + applies).
- Prod/CI: `prisma migrate deploy` (applies committed migrations only, never generates). Migration
  SQL files are committed and code-reviewed — schema changes go through the same gate as code.
- Greenfield: first migration is `init`. No legacy data to backfill.

### 3.2 Auth + User model

**Recommendation: Auth.js (NextAuth) v5** with the **Prisma adapter**, **Credentials** (email +
hashed password) for the initial provider.

- **Why:** v5 is App Router-native (single `auth()` helper usable in Route Handlers, Server
  Components, and `middleware.ts`), integrates with Prisma via an official adapter, and stays
  self-hosted (no per-seat cost — fits the budget mandate). Sessions via signed JWT cookie.
- **Tradeoff vs. alternatives:**
  - *Clerk / hosted auth* — fastest to ship, best UX, but external dependency + cost per MAU and
    another vendor holding user identity. Rejected: overkill for a 1–few user tool.
  - *Lucia / roll-your-own JWT* — most control, but we'd own password hashing, session rotation,
    CSRF, and reset flows by hand. Rejected: reinvents solved security-critical code; hands
    security-engineer more surface to audit.
  - *Auth.js v5* — chosen. **Cost:** v5 is comparatively new; some config APIs differ from v4
    docs, and the Credentials provider deliberately ships no password reset / verification — we
    own those. Password hashing = `argon2` or `bcrypt` (security-engineer picks params).
- **[VERIFY-NEXT]** Auth.js middleware + `auth()` rely on stock `middleware.ts`, `cookies()`,
  and Route Handler internals. Verify all three before the backend-developer wires it.

**User model** (minimal but real):

```
User { id, email (unique), passwordHash, displayName?, baseCurrency="THB",
       createdAt, updatedAt }
```
Portfolios FK to `User.id`. **Every** portfolio query is scoped by `userId` from the session —
there is no unscoped "get portfolio by id" path.

### 3.3 Testing + CI

- **Runner: Vitest.** Chosen over Jest: native ESM + TS + Vite transform (this stack is already
  ESM/TS), far less config, fast watch. **Cost:** smaller ecosystem than Jest and Vitest is not
  wired into Next by default — verify no conflict with the non-standard Next build; if it fights
  the toolchain, fall back to Jest (contract unchanged).
- **E2E: Playwright** (auth flow + one portfolio happy-path), added later — not a Phase 0 blocker.
- **Test layering:**
  1. **Pure unit tests** on `lib/portfolio/*` (cost basis, P&L, allocation, milestone) — no DB,
     no network. This is where the real coverage lives and why the math is isolated from HTTP.
  2. **Route Handler integration tests** against a throwaway Postgres (Testcontainers or the CI
     service container) with a seeded user.
- **CI: GitHub Actions**, minimal single workflow on PR + push:
  `install → lint (eslint) → typecheck (tsc --noEmit) → vitest → prisma migrate deploy against a
  postgres service container → next build`. **Cost:** adds ~a few min per PR; acceptable and it
  is the QA gate the org currently lacks. **[VERIFY-NEXT]** confirm `next build` succeeds
  headless in CI for this modified Next (it builds locally today — keep it green).

---

## 4. Layer B — Portfolio Management Module

### 4.1 Prisma schema DESIGN

> **Money rule (non-negotiable): every monetary or quantity field is Prisma `Decimal`
> (`@db.Decimal(24,8)`), NEVER `Float`/`number`.** Floats silently corrupt cost basis and P&L.
> Quantities use 8 dp (crypto sats-level); fiat presentation rounds at the edge, never in storage.
> The API serializes Decimal as a **string** to avoid JS float truncation on the wire — the UI
> formats strings, it does not do money math in the browser.

Entities and key fields (design, not final DDL):

**User** — see 3.2.

**Portfolio**
- `id` (cuid), `userId` → User, `name`, `baseCurrency` (default "THB"),
  `dcaTargetAmount` (Decimal, default 1_000_000), `dcaTargetCurrency` (default "THB"),
  `createdAt`, `updatedAt`.
- Index: `@@index([userId])`.

**Holding** — *derived cache*, one row per (portfolio, asset).
- `id`, `portfolioId` → Portfolio, `assetId` → Asset,
  `quantity` (Decimal), `avgCostPerUnit` (Decimal, in asset's native currency),
  `totalCostBasis` (Decimal = quantity × avgCost, native currency),
  `realizedPnl` (Decimal, accumulates on sells), `updatedAt`.
- Constraint: `@@unique([portfolioId, assetId])`. Index `@@index([portfolioId])`.
- **Recomputed from Transactions on every transaction write** (see 4.3). Stored (not computed
  on read) so list/allocation endpoints stay a single indexed query.

**Asset** — reference data (so "VOO" means the same thing everywhere).
- `id`, `symbol` (e.g. "VOO", "BTC"), `assetClass` (`EQUITY_ETF | EQUITY_STOCK | CRYPTO`),
  `nativeCurrency` (default "USD"), `name`, `priceSourceId` (e.g. CoinGecko coin id "bitcoin"
  for crypto; provider ticker for equities), `dividendTaxRatePct` (Decimal — **15 for US ETF w/
  W-8BEN, 30 for REIT like O**; see Assumptions).
- Constraint: `@@unique([symbol])`.

**Transaction** — *source of truth*.
- `id`, `portfolioId` → Portfolio, `assetId` → Asset,
  `type` (`BUY | SELL | DIVIDEND`),
  `quantity` (Decimal — 0 allowed for DIVIDEND cash),
  `pricePerUnit` (Decimal, native currency),
  `fee` (Decimal, native currency, default 0),
  `grossCashAmount` / `taxWithheld` (Decimal — for DIVIDEND, capture tax drag explicitly),
  `nativeCurrency`, `fxRateToBase` (Decimal — USD→THB **snapshotted at transaction time** so
  historical cost basis in THB is stable and not rewritten by today's FX),
  `tradedAt` (user-supplied), `note?`, `createdAt`.
- Indexes: `@@index([portfolioId, tradedAt])`, `@@index([assetId])`.

**PriceSnapshot** — cached external prices (rate-limit shield + history for charts later).
- `id`, `assetId` → Asset, `price` (Decimal, native currency), `currency`,
  `source` (`coingecko | equity-provider | mock`), `fetchedAt`.
- Index: `@@index([assetId, fetchedAt])`. Latest snapshot per asset drives valuation; a short
  TTL (e.g. 60s, matching the current 45s dashboard poll) decides fetch-vs-cache.

**DcaMilestone** (first-class, per mandate) — optional explicit checkpoints toward ฿1M.
- `id`, `portfolioId` → Portfolio, `label` (e.g. "฿250k"), `targetAmount` (Decimal),
  `targetCurrency`, `reachedAt?` (set when valuation first crosses it), `sortOrder`.
- Index `@@index([portfolioId])`. If not seeded, the milestone endpoint synthesizes 25/50/75/100%
  of `dcaTargetAmount` on the fly — so the feature works with zero setup.

**Relations summary:** User 1─* Portfolio 1─* {Holding, Transaction, DcaMilestone}; Asset 1─*
{Holding, Transaction, PriceSnapshot}. Assets are shared reference data across users (no user
scoping on Asset/PriceSnapshot — they hold no private data).

**Cost-basis storage decision.** Average cost is stored **denormalized on Holding**
(`avgCostPerUnit`, `totalCostBasis`) and recomputed deterministically from the Transaction log.
Rejected storing only transactions and computing basis on every read: correct but pays a full
recompute on hot read paths (allocation, valuation) that fire on the dashboard poll. Rejected
storing only the cached number without a transaction log: fast but unauditable and impossible to
correct a mistyped trade. Keeping both = fast reads + full auditability; **cost:** the recompute
routine must be the *single* writer of Holding and must run in the same DB transaction as the
Transaction insert (see 4.3) or the cache drifts.

### 4.2 API contract (Route Handlers)

All routes live under `app/api/portfolios/`. **Every handler resolves the session first; a
missing/invalid session → `401`. A resource whose `userId` ≠ session user → `404`** (not 403 —
don't leak existence of others' portfolios). All money fields are **strings** in JSON. Validate
request bodies with a schema (Zod recommended) and return `400` with field errors on failure.
Follow the existing try/catch + `source` marker convention for the read/valuation endpoints.

| Method | Path | Request body | Response (200) shape |
|---|---|---|---|
| GET | `/api/portfolios` | — | `{ portfolios: PortfolioSummary[] }` |
| POST | `/api/portfolios` | `{ name, baseCurrency?, dcaTargetAmount? }` | `{ portfolio: Portfolio }` (201) |
| GET | `/api/portfolios/[id]` | — | `{ portfolio: Portfolio, holdings: HoldingView[] }` |
| PATCH | `/api/portfolios/[id]` | `{ name?, dcaTargetAmount? }` | `{ portfolio: Portfolio }` |
| DELETE | `/api/portfolios/[id]` | — | `{ ok: true }` (204/200) |
| GET | `/api/portfolios/[id]/holdings` | — | `{ holdings: HoldingView[] }` |
| GET | `/api/portfolios/[id]/transactions` | query `?assetId&limit&cursor` | `{ transactions: Transaction[], nextCursor? }` |
| POST | `/api/portfolios/[id]/transactions` | `{ assetSymbol, type, quantity, pricePerUnit, fee?, tradedAt, taxWithheld?, note? }` | `{ transaction, holding: HoldingView }` (201) |
| PATCH | `/api/portfolios/[id]/transactions/[txId]` | partial of POST body | `{ transaction, holding }` |
| DELETE | `/api/portfolios/[id]/transactions/[txId]` | — | `{ ok: true, holding }` |
| GET | `/api/portfolios/[id]/valuation` | query `?display=THB\|USD\|both` | `{ asOf, fxRate, totals, source }` (see below) |
| GET | `/api/portfolios/[id]/allocation` | query `?by=asset\|class` | `{ asOf, slices: AllocationSlice[] }` |
| GET | `/api/portfolios/[id]/milestones` | — | `{ target, currentValueBase, pct, milestones[] }` |

**Key response shapes (contract — implement exactly):**

```
PortfolioSummary = { id, name, baseCurrency, currentValueBase: string,
                     unrealizedPnlBase: string, dcaTargetAmount: string, dcaPct: number }

HoldingView = { assetSymbol, assetClass, quantity: string,
                avgCostPerUnit: string, totalCostBasis: string,      // native ccy
                currentPrice: string, currentValueNative: string,
                currentValueBase: string,                            // THB
                unrealizedPnlNative: string, unrealizedPnlPct: number,
                priceSource: "coingecko"|"equity-provider"|"mock" }

valuation.totals = { costBasisBase: string, marketValueBase: string,
                     unrealizedPnlBase: string, unrealizedPnlPct: number,
                     costBasisUsd: string, marketValueUsd: string }

AllocationSlice = { key, label, marketValueBase: string, pct: number }  // pct sums ~100

milestones[] = { label, targetAmount: string, pct: number, reached: boolean, reachedAt? }
```

`source` is `"live" | "partial" | "mock"` — `partial` when some assets fell back to cached/mock
prices (e.g. equity provider down but crypto live). This mirrors the existing `holdingsSource`
honesty pattern and satisfies the "ห้ามกุข้อมูล / mark estimates" rule.

### 4.3 Data flow

**Write (record a buy/sell/dividend):**
1. UI form → `POST /api/portfolios/[id]/transactions`.
2. Handler: auth-scope → validate body → resolve/create `Asset` by symbol → snapshot
   `fxRateToBase` via `lib/fx-rate.ts` (or accept a passed rate) → within **one DB transaction**:
   insert `Transaction`, then call `lib/portfolio/recomputeHolding(portfolioId, assetId)` which
   replays that asset's transactions to recompute `quantity`, `avgCostPerUnit`, `totalCostBasis`,
   and `realizedPnl` (average-cost rules), and upserts the `Holding`.
3. Return the new transaction + updated `HoldingView`.

**Read (valuation / P&L / allocation):**
1. UI (portfolio page on mount + poll; or dashboard widget) → `GET .../valuation`.
2. Handler loads Holdings for the portfolio → for each distinct asset, gets a **current price**
   via the Price provider:
   - **Crypto:** reuse `lib/coingecko.ts::fetchLiveCryptoPrices` (already returns USD price).
   - **Equity ETF/stock (VOO/QQQM/SCHD/O):** **NEW** `lib/prices/equity.ts` — *no equity price
     source exists in the repo yet.* See Open Questions for provider choice; until decided it
     returns `mock` and the endpoint reports `source:"partial"/"mock"`.
   - Provider first checks `PriceSnapshot` (TTL ~60s); on miss, fetches live, writes a snapshot,
     returns it. On fetch failure → last snapshot or mock (never throw to the user).
3. FX: `lib/fx-rate.ts::fetchUsdToThbRate` (assume ~33 fallback per mandate) converts native
   USD values to THB base.
4. `lib/portfolio/valuation.ts` computes per-holding market value, unrealized P&L (market −
   cost basis), portfolio totals, and allocation %. Pure function over {holdings, prices, fx}
   → fully unit-testable.
5. Milestone endpoint = `valuation.marketValueBase` vs `dcaTargetAmount` → pct + which milestones
   crossed; stamps `reachedAt` when first crossed.

**Dividend tax drag:** DIVIDEND transactions store `grossCashAmount` and `taxWithheld` so net
yield reflects reality (US ETF 15% w/ W-8BEN, REIT ~30%). Net dividend income = Σ(gross − tax).
This keeps the platform's "คิด tax drag ปันผลเสมอ" mandate truthful rather than showing headline
yield.

### 4.4 UI surface — recommendation

**Recommendation: a dedicated route `app/portfolio/page.tsx` for the full module, PLUS a small
read-only `PortfolioWidget` on the existing pixel-office dashboard.**

- **Why a dedicated page, not a widget, for CRUD:** transaction entry, editable tables, and
  allocation charts need real layout space and forms. The dashboard widgets are tiny draggable
  windows (width ~300px) built for glanceable read-only data — cramming CRUD into one fights the
  existing UX. A full route also gets its own URL to auth-gate cleanly via middleware.
- **Why also a widget:** the dashboard is the app's home and the mandate is DCA-progress-focused.
  A `PortfolioWidget` showing **current value (THB/USD) + ฿1M milestone bar** gives the daily
  "are we on track / do nothing" signal that matches the platform's "ส่วนใหญ่ควรไม่ต้องทำอะไร"
  philosophy. It's read-only: it polls `GET .../valuation` + `.../milestones`, mirroring how
  `CompanyStatusWidget` polls `/api/company-status`.
- **Rejected: portfolio entirely as widgets.** Loses shareable/auth-gated URL and makes forms
  cramped. **Rejected: full page only (no widget).** Loses the at-a-glance DCA signal that is the
  product's core loop.

### 4.5 Integration with existing structure & client-only model

- **Folder placement (extends current conventions):**
  - `prisma/schema.prisma`, `prisma/migrations/` — new top-level (repo root of pixel-office).
  - `lib/db.ts`, `lib/auth.ts` — alongside existing `lib/` singletons.
  - `lib/portfolio/{recompute,valuation,allocation,milestone}.ts` — pure math.
  - `lib/prices/{index,equity}.ts` — new; **crypto path reuses existing `lib/coingecko.ts`**.
  - `app/api/portfolios/**/route.ts` — same handler style as existing `app/api/*`.
  - `app/portfolio/page.tsx` + `components/portfolio/*` — full UI.
  - `components/widgets/PortfolioWidget.tsx` + register in `PixelOfficePageClient.tsx`
    (`DEFAULT_LAYOUT`, `WIDGET_META`, `renderContent` switch) — same steps every existing widget
    followed.
  - `types/portfolio.ts` — shared DTO types (the string-money view models above).
- **Client-only model:** the dashboard stays `ssr:false`. The `PortfolioWidget` is a pure props
  component; the client page adds one more `useEffect` poll (reuse the exact
  fetch-poll-with-cleanup pattern already in `PixelOfficePageClient.tsx`). **The new `/portfolio`
  route is the app's first server-touching page** (auth + DB). Keep its data mutations on the
  server (Route Handlers) and let the client page be a `"use client"` island that fetches them —
  do **not** try to SSR-render private portfolio data through the existing NoSSR home; that page
  is deliberately client-only for hydration reasons documented in `app/page.tsx`.
- **Auth gating:** `middleware.ts` protects `/portfolio` and `/api/portfolios/*`; unauth →
  redirect to a login page / `401` for API. **[VERIFY-NEXT]** middleware matcher semantics.

---

## 5. Technology Choices

| Choice | Alternative considered | Why this one | Cost of this choice |
|---|---|---|---|
| Postgres + Prisma | SQLite (dev) / raw SQL | Org standard; Decimal + real types; typed client blocks money-as-float | Migration discipline; serverless connection pooling required |
| Serverless Postgres (Neon/Vercel) prod | Self-managed PG / Railway | Zero ops, free tier fits budget | Cold starts; must use pooled URL |
| Auth.js v5 (Credentials + Prisma) | Clerk (hosted) / Lucia / DIY JWT | App Router-native, self-hosted, no per-seat cost | v5 newness; we own reset/verify flows |
| Vitest | Jest | Native ESM/TS, minimal config, fast | Smaller ecosystem; verify vs modified Next |
| GitHub Actions CI | None (status quo) / other CI | Standard, free for this scale, gives QA the gate it lacks | ~mins per PR |
| Decimal money as JSON strings | number | No JS float corruption on wire or in storage | UI must format strings, not compute |
| Transaction log + derived Holding cache | Compute-on-read / cache-only | Fast reads + full auditability | Recompute must be sole writer, same DB txn |
| Reuse `lib/coingecko.ts` + `lib/fx-rate.ts` | New price abstraction from scratch | Proven, already in prod path | Equity prices still need a NEW source |

---

## 6. Non-Functional Considerations

- **Scalability:** designed for 1–few users, low RPS. Indexes on all `userId`/`portfolioId`
  filters and `PriceSnapshot(assetId, fetchedAt)`. PriceSnapshot TTL cache shields CoinGecko's
  free-tier rate limit — the dashboard already polls every 45s across all clients; without the
  cache, adding portfolio valuation would multiply outbound price calls. **Not** designed for
  multi-tenant scale the user hasn't asked for.
- **Reliability:** every external fetch (price, FX) degrades to cached snapshot → mock, never
  throws to the UI; endpoints report honest `source`. Single serverless DB is the main SPOF —
  acceptable at this scale; hosted PG provides backups.
- **Security (flagged for security-engineer, not left to discover):**
  - **Tenant isolation is the #1 risk.** Every portfolio/transaction query MUST filter by session
    `userId`; a single unscoped query = full data leak. Recommend a repository helper that *always*
    takes `userId` so an unscoped query is impossible to write by accident.
  - Password hashing (argon2/bcrypt), signed session cookie `httpOnly`+`secure`+`sameSite`.
  - Input validation (Zod) on every write → blocks injection of bad Decimals/negative quantities;
    Prisma parameterizes queries (SQLi mitigated) but validate business rules (no sell > holding).
  - Secrets (`DATABASE_URL`, auth secret, any price-provider key) in env only, never committed;
    extend the existing env-key pattern. Add `.env.example`.
  - IDOR on `[id]`/`[txId]` params — covered by the 404-on-mismatch rule above; test it explicitly.
- **Cost:** Postgres free tier + Vercel + CoinGecko free + free FX API = ~$0 until scale; the
  only likely paid line is an equity price provider (see Open Questions).
- **Data integrity:** Decimal everywhere; recompute-in-transaction; FX rate snapshotted per
  transaction so historical THB cost basis is immutable.

---

## 7. Tradeoffs & Risks

- **Equity price source is an unsolved gap.** The repo has crypto (CoinGecko) + FX, but **no
  equity price feed** for VOO/QQQM/SCHD/O — the mandate's core assets. Free equity APIs
  (Alpha Vantage, Finnhub, yfinance-style) have tight rate limits or ToS constraints. Until
  chosen, equity valuation is `mock`/`partial`. **This is the highest-impact open decision.**
- **Derived-cache drift** if the recompute is ever bypassed. Mitigation: single writer +
  same-transaction recompute + a unit test asserting Holding == replay(transactions).
- **Average-cost assumption** may not match the user's tax reporting (Thai taxable account).
  If they need FIFO/specific-lot for realized-gain reporting, the schema still holds (transaction
  log is complete) but the recompute algorithm changes — decide before building the math.
- **Auth.js v5 newness vs. the modified Next build** — the biggest **[VERIFY-NEXT]** risk;
  middleware/`cookies()` internals could differ. Fallback: a minimal self-issued JWT-in-cookie
  if Auth.js won't cooperate (more security surface — last resort).
- **Client-only home vs. server auth** — mixing an SSR/auth route into an app that deliberately
  avoids SSR. Kept isolated: `/portfolio` is its own route; the dashboard widget stays a dumb
  poller. Risk if someone tries to unify them.

---

## 8. Open Questions for the CEO / user

1. **Equity price provider** — which source for VOO/QQQM/SCHD/O, and is a small paid API tier
   acceptable, or must it stay free (accepting delayed/rate-limited quotes)?
2. **Cost-basis method** — average cost (assumed) OK, or does Thai tax reporting need FIFO /
   specific-lot? Affects the recompute algorithm only.
3. **Single user or multi-user?** Confirms whether full Auth.js is warranted now or a single
   hard-coded owner suffices for v1 (schema unchanged either way).
4. **Multi-portfolio per user** (e.g. "Core DCA" vs "Tactical") or exactly one? Schema supports
   many; confirms UI complexity.
5. **Manual transaction entry** (assumed) — or should we later auto-import from MEXC/exchange
   APIs the repo already scaffolds (`lib/exchanges/*`)? Out of scope for this phase but affects
   whether Transaction needs an `externalId`/`source` dedupe field now.
6. **FX handling** — snapshot FX per transaction for cost basis (recommended) vs. always
   today's rate? Confirms the `fxRateToBase` design.
7. **Hosting** — Neon vs. Vercel Postgres vs. other; determines the exact pooling config.

---

## 9. Assumptions (labeled — CEO may veto)

- **Investor mandate:** THB base currency, USD shown alongside at FX ~33; balanced risk, 5–10yr
  horizon; goal = DCA portfolio → **฿1,000,000**; core assets VOO, QQQM, SCHD, O; **taxable Thai
  account so dividend tax drag matters** (US ETF 15% w/ W-8BEN, REIT ~30%). Encoded as
  `dcaTargetAmount=1_000_000 THB` and `Asset.dividendTaxRatePct`.
- **Prices:** transactions entered **manually**; live market price pulled only for valuation.
- **Cost basis:** **average cost** method (simplest correct default).
- **Assets in scope:** **US ETFs/stocks + crypto** (app is already crypto-heavy).
- **Greenfield schema** — no existing DB to migrate.
- **DCA milestone tracking toward ฿1M is a first-class feature** (`DcaMilestone` + `/milestones`).
- **Scale:** single user or small trusted team, low RPS (not a multi-tenant SaaS).

---

## 10. Suggested implementation sequence (guidance, not task assignment)

1. **database-engineer** — finalize `prisma/schema.prisma` (Decimal everywhere), `lib/db.ts`
   singleton, first migration, `.env.example`, docker-compose Postgres for dev. Unblocks everyone.
2. **devops-engineer** (parallel) — GitHub Actions workflow (lint/typecheck/vitest/migrate/build)
   with a Postgres service container; confirm `next build` stays green in CI. **[VERIFY-NEXT]**.
3. **backend-developer / security-engineer** (together) — Auth.js v5 + Credentials + Prisma
   adapter, `middleware.ts` gating, the `userId`-always repository helper, tenant-isolation tests.
4. **backend-developer** — `lib/portfolio/*` pure math + `lib/prices/*` (reuse coingecko/fx; stub
   equity), then the Route Handlers per §4.2 with Zod validation + mock-fallback pattern.
5. **qa-engineer** (parallel from step 4) — Vitest unit tests on the pure math (cost basis, P&L,
   allocation, milestone, dividend tax drag) and Route Handler integration tests incl. IDOR/404.
6. **frontend-developer** — `app/portfolio` full page + `components/portfolio/*` forms/tables,
   then `PortfolioWidget` registered in `PixelOfficePageClient.tsx` (poll pattern reuse).
7. **security-engineer** — final pass: cookie flags, secret handling, no unscoped queries,
   negative-quantity / sell-more-than-held rejection.

Before step 3, resolve **Open Questions 1 (equity provider)** and **2 (cost-basis method)** with
the CEO/user — they change price integration and the recompute algorithm respectively.
