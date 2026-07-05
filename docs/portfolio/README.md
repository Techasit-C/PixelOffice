# Portfolio Management Module

Per-user investment portfolio tracking inside **pixel-office** (the Next.js "AI trading company" dashboard). Track holdings across US stocks/ETFs and crypto, record buy/sell/dividend/fee transactions manually, value them against live market data, and follow DCA progress toward a ฿1,000,000 goal.

> This README documents the **implemented code** as it exists today (the module is complete; 56/56 unit tests pass). The original design specification is `docs/portfolio-architecture.md` (marked "DESIGN ONLY"); several of its proposals were overridden during the build. When they disagree, **the code — and this doc — win.** Most significant deviations: auth is **Clerk** (not Auth.js); equities use **Finnhub**; there is **no `dividendTaxRatePct` column** (tax drag is a pure-function seam instead).

## Documentation map

| Document | Read it for |
|---|---|
| `README.md` (this file) | Overview, env setup, running locally |
| `api-reference.md` | Every endpoint incl. `/performance`: method, path, request, response, status codes |
| `architecture.md` | Data-flow diagram (UI → route → engine → Prisma → Neon) and the snapshot/cron seam |
| `database-model.md` | Tables, fields, relations, indexes, Decimal-precision rationale |
| `provider-layer.md` | Market-data abstraction, caching/fallback, adding a provider |
| `valuation-engine.md` | Average-cost algorithm, FX immutability, tax-drag seam, snapshot flow |
| `security-notes.md` | Tenant isolation, IDOR→404, validation, rate limiting, known limitations |
| `extension-guide.md` | Adding a cost-basis method, asset type, provider, metric, cron wiring |

## Features

- **Multiple portfolios per user**, each with a configurable base currency (default `THB`) and cost-basis method (default `AVERAGE_COST`).
- **Immutable transaction ledger** (`Transaction` = source of truth) with a **derived `Holding` cache** recomputed atomically on every write.
- **Live valuation** in THB and USD: per-holding market value, cost basis, and unrealized P&L, with an honest `source` marker (`live` / `partial` / `mock`) that never presents degraded pricing as live.
- **Allocation** breakdown by asset symbol or by asset class.
- **DCA milestones** toward ฿1,000,000 — uses explicit `DcaMilestone` rows if present, otherwise synthesizes 25/50/75/100% checkpoints so the feature works with zero setup.
- **Performance history**: a `PortfolioValueSnapshot` time series feeding a TradingView Lightweight Charts-shaped series (`{ time: <unix seconds>, value: <string> }`) via `GET /api/portfolios/[id]/performance`, plus a manual capture trigger (`POST`).
- **Market-data provider layer**: Finnhub (equities/ETFs), CoinGecko (crypto), open.er-api.com (USD→THB FX), behind a caching + snapshot-fallback service.
- **Security hardening**: branded-type tenant isolation choke point, IDOR→404, fail-closed auth, Zod + bounded-decimal validation, P2002→409, per-user rate limiting, and secret redaction in logs.
- **UI**: a full `/portfolio` management page plus a read-only `PortfolioWidget` on the pixel-office dashboard (value + DCA progress bar).

Average cost is the **only cost-basis method currently implemented**. `FIFO` / `LIFO` / `SPECIFIC_LOT` exist as enum values and a strategy-interface seam, but selecting them throws `"Cost-basis method not implemented yet"` on the first write (see `valuation-engine.md`).

## How it fits into pixel-office

pixel-office is otherwise a **client-only** dashboard (`app/page.tsx` renders through a `NoSSR` boundary and polls public `/api/*` routes). The Portfolio module is the app's **first server-touching, per-user, database-backed feature**:

- `/portfolio` (`app/portfolio/page.tsx`) is server-safe (its initial render is a deterministic loading gate) and delegates to a `"use client"` island (`PortfolioPageClient`) that calls the Route Handlers.
- The dashboard `PortfolioWidget` is a pure read-only poller of the portfolio list summary, mirroring how the existing widgets poll their APIs. It degrades gracefully (loading / empty / error) so an API `401` in dev never breaks the office.
- All data mutations stay on the server in `app/api/portfolios/**` Route Handlers, which own auth scoping, validation, and error mapping.

> **Non-standard Next.js caveat:** `pixel-office/AGENTS.md` warns this is not stock Next.js. Every portfolio Route Handler declares `export const runtime = "nodejs"` because the standard Prisma client cannot run on the Edge runtime. Dynamic-segment handlers receive `{ params }` as a **Promise** (`params: Promise<{ id: string }>`), awaited inside each handler.

## Tech stack (verified from `package.json`)

Next.js `^15.5.20` (App Router) · React `19.2.4` · TypeScript 5 (strict) · Tailwind v4 · Prisma `^6.19.3` + `@prisma/client` · Neon Postgres · Clerk (`@clerk/nextjs ^7.5.12`) · Zod `^4.4.3` · Vitest `^4.1.10`.

## Environment variables

Copy `.env.example` to `.env` (gitignored) and fill in real values. **The app builds and runs with none of these set** — it degrades: portfolio routes return `401` (no Clerk), and market data falls back to cached snapshots then mock.

### Database (Prisma + Neon) — required for any DB-backed behavior

| Var | Purpose |
|---|---|
| `DATABASE_URL` | **Pooled** connection (Neon pgBouncer; host contains `-pooler`, `pgbouncer=true`). Used by the app at runtime. |
| `DIRECT_URL` | **Unpooled/direct** connection (host without `-pooler`). Used **only** by `prisma migrate` / `db push` / introspection — migrations cannot run through pgBouncer. |

For local dev against a local/Docker Postgres, both may point at the same direct URL.

### Auth (Clerk) — required for authenticated access

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_...`). |
| `CLERK_SECRET_KEY` | Clerk secret key (`sk_...`). |

If **both** are absent, `middleware.ts` skips Clerk entirely and passes requests through; portfolio routes then return `401` (correct fail-closed behavior — `auth()` throws → `Unauthorized`).

### Market data (all optional — missing keys degrade to cache/mock)

| Var | Purpose |
|---|---|
| `FINNHUB_API_KEY` | US stock/ETF quotes (VOO/QQQM/SCHD/O). Sent via the `X-Finnhub-Token` header, never in the URL. |
| `COINGECKO_API_KEY` | Optional CoinGecko free "Demo" key (`x-cg-demo-api-key`); raises rate limits. |
| — | FX (USD/THB) uses open.er-api.com, which needs no key; on failure it falls back to the mandate rate ~33. |

### Rate limiting (optional — read by `lib/api/rate-limit.ts`)

| Var | Default | Purpose |
|---|---|---|
| `RATE_LIMIT_DISABLED` | unset | Set to `1` to disable rate limiting entirely (all buckets use a no-op limiter). |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Fixed-window size in ms (shared by all buckets). |
| `RATE_LIMIT_WRITE_MAX` | `30` | Max requests per window in the `write` bucket. |
| `RATE_LIMIT_READ_MAX` | `60` | Max requests per window in the `providerRead` bucket. |

Only positive finite integers are honored; anything else falls back to the default. (These are read by the limiter but are **not** listed in `.env.example`.)

## Local development

```bash
cd pixel-office
npm install            # runs `prisma generate` via postinstall
cp .env.example .env   # then fill in DATABASE_URL + DIRECT_URL (+ optional keys)
```

Scripts (from `package.json`):

| Command | Does |
|---|---|
| `npm run dev` | Next dev server (`--hostname 0.0.0.0 --allowed-hosts 192.168.1.38`) |
| `npm run build` | `next build` (compiles the whole app incl. portfolio routes) |
| `npm run start` | `next start` (serve the production build) |
| `npm test` | `vitest run` (56 tests pass at time of writing) |
| `npm run test:watch` | `vitest` watch mode |
| `npm run db:generate` | `prisma generate` |
| `npm run db:migrate` | `prisma migrate dev` (**needs a live `DIRECT_URL`**) |
| `npm run db:deploy` | `prisma migrate deploy` (CI/prod; applies committed migrations only) |
| `npm run db:studio` | `prisma studio` |

Open `http://localhost:3000/portfolio` for the management UI; the dashboard home (`/`) shows the `PortfolioWidget`. Without Clerk keys the API returns `401` and the UI renders a friendly "login required (Clerk not configured in dev)" state rather than crashing.

### Applying migrations

Migrations live in `prisma/migrations/{0_init, 1_perf_and_tenant_uniqueness}`. Applying them requires a **live Neon (or Postgres) `DIRECT_URL`**:

```bash
npm run db:deploy      # applies committed migrations in order, never generates SQL
```

> **Migration ordering note (from the migration headers):** `0_init` was generated offline and, per its own comment, **has never been applied to any database**. `1_perf_and_tenant_uniqueness` is written as an incremental on top of it: it drops the old **global** `transactions(source, externalId)` unique index, replaces it with the tenant-scoped `transactions(portfolioId, source, externalId)` index, and creates the `portfolio_value_snapshots` table. On a greenfield Neon database `prisma migrate deploy` applies both in order, so the live DB ends up with the tenant-scoped constraint.

## Unverified / pending live credentials

The following are correct by code inspection but **not yet verified against live services** (no Neon DB provisioned, no Clerk/Finnhub keys configured at documentation time):

- Actual Clerk sign-in → `requireUser()` provisioning of a local `User` row.
- Applying the migrations against a real Neon instance.
- Live Finnhub/CoinGecko/FX fetches and `PriceSnapshot` persistence.
- Live daily snapshot capture (no scheduler exists — see the cron seam in `architecture.md` and `valuation-engine.md`).
- Cross-instance rate limiting (the default limiter is in-process only — see `security-notes.md`).
