# Production Deployment — pixel-office

Owner: devops-engineer. **This document is preparation only — no deploy has been run.**

Target stack: **Vercel** (Next.js 15 App Router + Route Handlers) · **Neon PostgreSQL**
(Prisma v6) · **Clerk** auth · market data via **Finnhub / CoinGecko / open.er-api FX**.

Design property that MUST be preserved: the app **builds and boots without credentials**
(middleware passthrough when Clerk keys absent, providers fall back to mock, portfolio
routes self-enforce 401). Nothing below adds a hard env dependency to that boot path.

---

## 0. Files that make up this config

| File | Purpose |
|---|---|
| `vercel.json` | Framework preset, Prisma-safe build command, region, daily cron entry + cron `functions.maxDuration` |
| `lib/env.ts` | Import-safe zod env validation (production-strict, dev/build-tolerant) |
| `scripts/check-env.mjs` | Zero-dep deploy PREFLIGHT gate (`npm run check:env`) |
| `.env.example` | Documents every env var + which are production-required |
| `prisma/schema.prisma` | `DATABASE_URL` (pooled) + `DIRECT_URL` (direct) |
| `docs/deployment.md` | This file — deploy + rollback checklists |

Prisma routes already set `export const runtime = "nodejs"` in code, so no per-function
runtime override is needed in `vercel.json`.

---

## 1. Environment variables — scope matrix

Set these in **Vercel → Project → Settings → Environment Variables**. Use placeholders
here; real values live only in Vercel (and Neon/Clerk dashboards). Never commit secrets.

| Variable | Prod | Preview | Dev | Required? | Notes |
|---|:--:|:--:|:--:|---|---|
| `DATABASE_URL` | ✅ | ✅ | ⬜ | **prod-required** | Neon **pooled** (`-pooler` host, `pgbouncer=true`). App runtime. |
| `DIRECT_URL` | ✅ | ✅ | ⬜ | **prod-required** | Neon **unpooled/direct** (no `-pooler`). `prisma migrate` only. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | ✅ | ⬜ | **prod-required** | `pk_live_…` in Prod, `pk_test_…` in Preview. Public (bundled). |
| `CLERK_SECRET_KEY` | ✅ | ✅ | ⬜ | **prod-required** | `sk_live_…` / `sk_test_…`. Secret. |
| `CRON_SECRET` | ✅ | ⬜ | ⬜ | **prod-required** | `openssl rand -hex 32`. Vercel sends it as `Authorization: Bearer …`. |
| `FINNHUB_API_KEY` | ➖ | ➖ | ➖ | optional | Missing → cache → mock (`source:"partial"/"mock"`). |
| `COINGECKO_API_KEY` | ➖ | ➖ | ➖ | optional | Raises rate limits only. |
| `TRADINGVIEW_WEBHOOK_SECRET` | ➖ | ➖ | ➖ | optional | Rejects unauthenticated webhook calls when set. |
| `BYBIT_*/BITGET_*/MEXC_*` | ➖ | ➖ | ➖ | optional | Affiliate widgets; mock without them. |
| `RATE_LIMIT_*` | ➖ | ➖ | ➖ | optional | Sane defaults in `lib/api/rate-limit.ts`. |

Legend: ✅ set · ➖ optional · ⬜ leave unset (keyless dev/build path).

> Preview deployments should use **Clerk test keys** and a **separate Neon branch/DB**,
> never production identity or production data.

### Neon connection strings (placeholders)
```
# Pooled — app runtime. Note "-pooler" host + pgbouncer=true.
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require&pgbouncer=true"
# Direct — migrations only. Same DB, host WITHOUT "-pooler".
DIRECT_URL="postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DBNAME?sslmode=require"
```
Migrations **cannot** run through pgBouncer — that is exactly why `DIRECT_URL` exists and
why `prisma migrate deploy` targets it.

### Region
`vercel.json` pins `regions: ["iad1"]` (US East / Virginia). **Match this to your Neon
region** to minimize app↔DB latency — if your Neon project is in, e.g., `eu-central-1`,
change it to `fra1`. Vercel↔Neon in different continents adds latency to every query.

---

## 2. Prisma on Vercel — build + migrate

- **`prisma generate` at build:** `package.json` has a `postinstall: prisma generate`,
  but Vercel can serve `node_modules` from cache and skip `postinstall`, shipping a stale
  client. `vercel.json` therefore sets `buildCommand: "prisma generate && next build"` so
  the client is regenerated on every build regardless of install cache. This is the
  Prisma-recommended pattern for Vercel.
- **Migrations are a SEPARATE, EXPLICIT release step — never auto-run destructively.**
  Apply with `prisma migrate deploy` against `DIRECT_URL` (see checklist below).
  Current migrations (`0_init`, `1_perf_and_tenant_uniqueness`) are **additive/greenfield
  and not yet applied** — no live DB exists yet.

---

## 3. Daily snapshot cron

`vercel.json` registers the schedule plus a per-function duration cap:
```json
"functions": {
  "app/api/cron/snapshot/route.ts": { "maxDuration": 60 }
},
"crons": [
  { "path": "/api/cron/snapshot", "schedule": "0 22 * * *" }
]
```
- **Route (CR-DEPLOY-01 RESOLVED):** `POST /api/cron/snapshot`
  (`app/api/cron/snapshot/route.ts`, `runtime = "nodejs"`) now exists. It bearer-auths
  against `CRON_SECRET`, loads every portfolio, and calls `capturePortfolioSnapshot` for
  each **sequentially** (batch logic in `lib/cron/snapshot-batch.ts`), returning a
  `{processed,succeeded,failed,skipped,failures?}` summary. The cron `path` matches the
  route, so it no longer 404s.
- **Schedule:** `0 22 * * *` = 22:00 **UTC** daily (~5–6pm US Eastern), after US market
  close so prices have settled. Vercel Cron runs in UTC. Snapshots key on start-of-UTC-day
  (`startOfUtcDay` in `snapshot-service.ts`) and upsert idempotently, so exact minute and
  retries are safe.
- **Auth:** when `CRON_SECRET` is set, Vercel sends `Authorization: Bearer <CRON_SECRET>`
  to the cron path. The endpoint MUST verify it and reject otherwise (401). `CRON_SECRET`
  must therefore be set in **Vercel Production** (see §1 matrix) or every scheduled call
  gets a 401 and no snapshots are captured.
- **`maxDuration = 60` (seconds):** the job values portfolios SEQUENTIALLY, each fanning
  out multiple market-data calls, so wall-clock grows with portfolio count. 60s is a
  deliberate, plan-safe cap.
  - **[VERIFY-NEXT] Plan ceiling dependency:** 60s is the **Hobby** max; **Pro** allows up
    to 300s. Confirm the deploying account's plan before assuming headroom — on Hobby a
    value >60 is rejected at build; on Pro you may raise it to 300 if the batch outgrows
    60s. The `functions` key targets the App Router source file
    (`app/api/cron/snapshot/route.ts`), the form Vercel documents for Next.js; verified to
    match a real file so it does not fail the build.
- **[VERIFY-NEXT] Cron frequency limit:** confirm your Vercel plan allows this cron
  frequency (Hobby historically limits crons to once/day; daily is within that, but verify
  against your current plan/limits before relying on it).

---

## 4. DEPLOY checklist (ordered, runnable)

Blast radius of a first prod deploy: **Production environment only** (new Neon DB, new
Clerk prod instance, Vercel Production). No existing users/data at greenfield.

1. **Provision Neon** — create project + database. Copy the **pooled** (`-pooler`) and
   **direct** connection strings from Neon → Connection Details.
2. **Provision Clerk** — create a Production instance; copy `pk_live_…` + `sk_live_…`.
   (Create/keep a separate test instance for Preview.)
3. **Provision Finnhub** (optional but recommended for live prices) — copy API key.
4. **Set Vercel env vars** per the scope matrix in §1 (Production scope; Preview with test
   keys + a Neon branch). Generate `CRON_SECRET` with `openssl rand -hex 32`.
5. **Preflight the env locally/CI** against the prod values:
   ```bash
   npm run check:env -- --prod      # exits 1 if any prod-required var is missing
   ```
6. **Apply migrations** (explicit release step, against the DIRECT url):
   ```bash
   # Run with DIRECT_URL pointing at the Neon direct host (NOT pooled).
   npx prisma migrate deploy
   ```
   This applies `0_init` + `1_perf_and_tenant_uniqueness`. It is additive; on a fresh DB
   it creates all tables. Verify with `npx prisma migrate status`.
7. **Deploy** to Vercel (Git push to the production branch, or `vercel --prod`). Build runs
   `prisma generate && next build`.
8. **Smoke-verify** (production URL):
   - App loads (dashboard renders).
   - `GET /api/company-status` responds.
   - Signed-out `GET /api/portfolios` → **401** (auth enforced).
   - Sign in via Clerk → `GET /api/portfolios` → **200**.
   - `POST /api/portfolios/[id]/performance` on a test portfolio → **201** (snapshot write
     path + DB reachable).
9. **Enable/verify cron** — Vercel → Project → **Cron Jobs** shows the daily job. The
   capture-all endpoint now exists (CR-DEPLOY-01 resolved), so the job does real work once
   `CRON_SECRET` is set in Production. Trigger it once manually (Vercel dashboard "Run" or
   curl with the Bearer secret) and confirm snapshots land and the summary reports
   `succeeded`/`skipped` as expected. A missing/wrong `CRON_SECRET` yields 401 — no writes.

---

## 5. ROLLBACK checklist

### 5a. Bad application deploy → Vercel Instant Rollback
Blast radius: **Production traffic**, reverts instantly (no rebuild).
- Vercel → Project → **Deployments** → pick the last-known-good deployment →
  **⋯ → Promote to Production** (a.k.a. Instant Rollback). Serving flips to the old
  immutable build immediately.
- CLI alternative: `vercel rollback <deployment-url>`.
- Env-var change gone bad: revert the value in Settings → **redeploy** (env changes need a
  new deployment to take effect; instant rollback alone reuses the old build's env binding).

### 5b. Bad migration → Prisma
Blast radius: **the Neon database (all environments pointing at it)** — treat as
higher-risk than an app rollback.
- These migrations are **additive/greenfield**, so a failed apply typically leaves prior
  tables intact rather than dropping data. `npx prisma migrate status` shows what applied.
- **General down-strategy (Prisma has no auto "down"):**
  1. Prefer **roll FORWARD** — author a new corrective migration (`prisma migrate dev`
     locally against a branch, then `migrate deploy`) rather than hand-editing history.
  2. For destructive/blocking cases, restore from a **Neon branch/point-in-time restore**
     taken before the deploy (create a pre-migration Neon branch as your snapshot).
  3. If a migration is marked failed, resolve it explicitly with
     `npx prisma migrate resolve --rolled-back <migration_name>` (or `--applied`) — this is
     a **destructive/history-editing op; requires explicit human confirmation**, never run
     it silently in CI.
- ⚠️ Do **not** `prisma db push`/`migrate reset` against production — `reset` DROPS the
  database. That is a destructive operation requiring explicit confirmation.

### 5c. Disable the cron
- Vercel → Project → **Cron Jobs** → disable the job, **or** remove the `crons` entry from
  `vercel.json` and redeploy. Rotating/removing `CRON_SECRET` also makes the endpoint
  reject scheduled calls.

---

## 6. Change Requests (for the BACKEND team — NOT implemented here)

**CR-DEPLOY-01 — Implement the capture-ALL cron endpoint `POST /api/cron/snapshot`. ✅ RESOLVED.**
- **Status: shipped by the backend team; devops config now wired.** The route
  `app/api/cron/snapshot/route.ts` exists with core batch logic in
  `lib/cron/snapshot-batch.ts`, and `vercel.json` now carries the matching
  `functions.maxDuration` entry (see §3). The registered cron path resolves — no more 404.
- Delivered behavior (verified by reading the route + batch module):
  - `export const runtime = "nodejs"` (Prisma). ✅
  - Fail-closed `Authorization: Bearer <CRON_SECRET>` check (constant-time; unset secret
    rejects); 401 otherwise. No Clerk path. ✅
  - Loads every portfolio server-side, brands each via `asSystemOwnedPortfolio()`, calls
    `capturePortfolioSnapshot(...)` SEQUENTIALLY; empty portfolios (`_count.holdings === 0`)
    are skipped. ✅
  - Idempotent via `@@unique([portfolioId, capturedAt])` upsert. ✅
  - `functions.maxDuration = 60` added to `vercel.json` **after** the route file existed;
    glob verified to match the real file so it does not fail the Vercel build. ✅
    (Plan-ceiling caveat: Hobby 60s / Pro 300s — see §3 `[VERIFY-NEXT]`.)
- **RC2 signed off 2026-07-07 (code-readiness).** Full gate suite witnessed by
  qa-engineer + devops-engineer: `npm run lint` = **0**, `npm run test` = **0** (69 tests /
  8 files; `tests/cron-snapshot.test.ts` 13/13), keyless `npm run build` = **0** (12 pages,
  route present as a dynamic function). `npm run check:env -- --prod` = **1** is the
  EXPECTED keyless result (prod-required vars intentionally unset locally), not a defect.
  This clears CODE readiness only — production deploy still requires the 4 deploy-time steps
  in §7 "RC2 verification". Full detail: §7 and `docs/release-notes/RC2.md`.

**CR-DEPLOY-02 (optional) — fail-fast env at prod runtime.**
- `lib/env.ts` `assertEnv()` is available but intentionally not wired into the boot path
  (to protect keyless boot). If you want prod to hard-fail on misconfig, call `assertEnv()`
  from an explicit server boot/health route — not from middleware or `lib/db.ts`.

---

## 7. Verification status & caveats

### RC2 verification — 2026-07-07 (SIGNED OFF: code-readiness)

Full gate suite for **CR-DEPLOY-01** run this session by qa-engineer + devops-engineer in a
**keyless local environment** (no DATABASE_URL / Clerk / CRON_SECRET set). Witnessed results:

| Gate | Command | Exit | Verdict |
|---|---|:--:|---|
| Lint | `npm run lint` | 0 | **PASS** |
| Test | `npm run test` (`vitest run`) | 0 | **PASS** — 8 test files, 69 tests. `tests/cron-snapshot.test.ts` = **13/13** (auth fail-closed + batch aggregation). |
| Build | `npm run build` (`next build`, keyless) | 0 | **PASS** — 12 pages; `/api/cron/snapshot` present in the route manifest as a **dynamic function**. |
| Env preflight | `npm run check:env -- --prod` | 1 | **EXPECTED / working-as-designed** (see below) — **not** a defect. |

**Exit-1 on the env preflight is CORRECT here, not a failure.** In a keyless local environment
the preflight gate *should* exit 1: it is flagging the prod-required vars that are intentionally
unset locally — `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
`CLERK_SECRET_KEY`, `CRON_SECRET` (the `REQUIRED` list in `scripts/check-env.mjs`). This is a
**deploy-time gate**: it must exit **0** only when run against REAL Vercel Production values.
Exit 1 locally = the gate is doing its job. The keyless **build** gate is green *independently*
of the env preflight (nothing in the app graph imports `check-env.mjs`; `CRON_SECRET` is read at
request time, never at build — see §3), so the exit-1 does not gate or contradict the green build.

> **Invocation matters:** use `npm run check:env -- --prod` (with the `--`). The form
> `npm run check:env --prod` lets **npm** consume `--prod` as its own flag before it reaches
> `scripts/check-env.mjs`, so `forceStrict` never turns on.

**Sign-off scope — CODE-READINESS ONLY.** RC2 is officially signed off for code readiness. It is
**NOT yet cleared for a production deploy.** Clearing production still requires, at deploy time:
1. Real prod env configured in Vercel (§1 matrix).
2. `npm run check:env -- --prod` = **0** against those real values.
3. `prisma migrate deploy` applied on `DIRECT_URL` (§2, §4 step 6).
4. The §4 step-8 smoke checks **plus** one manual cron **"Run"** (§4 step 9) confirming snapshots
   land and the `{processed,succeeded,failed,skipped}` summary is as expected.

See `docs/release-notes/RC2.md` for the release summary of what CR-DEPLOY-01 ships.

### Standing caveats

- `npm run build` was re-run after adding this config **with no credentials** to confirm
  the keyless build still passes — see the engineer's report for the exact exit status.
  The build was re-run **again after adding the `functions.maxDuration` entry** to confirm
  the `functions` glob matches the real route file and did not break the build (a glob
  matching no file fails Vercel's build).
- `[VERIFY-NEXT]` Next.js 15.5.20 is flagged by `AGENTS.md` as possibly non-standard.
  `vercel.json` uses only stable, framework-agnostic keys (`framework`, `buildCommand`,
  `regions`, `crons`, `functions`); the `functions` key targets the App Router source file
  `app/api/cron/snapshot/route.ts` (Vercel's documented Next.js form). No assumptions were
  made about custom build output.
- `[VERIFY-NEXT]` Confirm Vercel picks up `NEXT_PHASE=phase-production-build` in your build
  (used by `lib/env.ts` to stay build-tolerant). It is Next's standard build-phase value;
  regardless, `assertEnv()` is not on the build path, so a mismatch cannot break the build.
- No deploy, migration, or live cron run has been performed. Everything above requires live
  Neon/Clerk credentials to execute.
