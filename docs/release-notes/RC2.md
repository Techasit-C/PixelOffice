# Release Notes — RC2 (CR-DEPLOY-01)

**Date:** 2026-07-07
**Status:** Release candidate — **signed off for code-readiness**. NOT yet cleared for
production deploy (see the pre-production checklist below).
**Change request:** CR-DEPLOY-01 — Implement the capture-ALL cron endpoint
`POST /api/cron/snapshot`.

---

## What this release ships

CR-DEPLOY-01 realizes the daily "value every portfolio" job that `snapshot-service.ts`
had left as a seam. Four pieces land together:

1. **Daily portfolio-valuation snapshot cron** — `POST /api/cron/snapshot`
   (`app/api/cron/snapshot/route.ts`, `export const runtime = "nodejs"` for Prisma).
   The route loads every portfolio server-side, brands each with
   `asSystemOwnedPortfolio()` (the one legitimate system-wide caller — never reachable
   from a user request), and hands them to the batch runner.

2. **Fail-closed `CRON_SECRET` auth** — the endpoint checks
   `Authorization: Bearer <CRON_SECRET>` via `authorizeCron()`. It returns `true` ONLY
   when a secret is configured AND the request carries exactly that secret; an
   unset/empty secret, a missing/malformed header, a wrong secret, or a prefix of the
   real secret all reject. The compare is constant-time over fixed-width SHA-256 digests.
   Any failure yields a generic `401` — the secret is never echoed or logged. There is
   **no Clerk path** here; with no logged-in user, the shared secret is the only gate.

3. **Sequential, idempotent batch** — core logic lives in `lib/cron/snapshot-batch.ts`
   (`runSnapshotBatch`), factored out of the route so it is unit-testable without a DB,
   market-data providers, or the Next request pipeline. Portfolios are processed
   **sequentially on purpose**: each valuation fans out one provider call per holding
   (+ FX), so parallelism would multiply the burst against shared provider quotas. Each
   portfolio runs in its own try/catch, so a single failure never aborts the batch.
   Empty portfolios (`_count.holdings === 0`) are skipped. Re-running the same day is
   safe — the DB upsert (`@@unique([portfolioId, capturedAt])`) makes each capture
   idempotent. The endpoint returns a `{processed, succeeded, failed, skipped, failures?}`
   summary, with any secrets in error strings redacted.

4. **`vercel.json` cron wiring** — schedule `0 22 * * *` (22:00 UTC daily, after US
   market close) pointing at `/api/cron/snapshot`, plus a per-function duration cap
   `functions."app/api/cron/snapshot/route.ts".maxDuration = 60`. The cron `path` now
   matches a real route, so it no longer 404s.

---

## Verification results (RC2, 2026-07-07)

Full gate suite run this session by qa-engineer + devops-engineer in a **keyless local
environment** (no `DATABASE_URL` / Clerk keys / `CRON_SECRET` set):

| Gate | Command | Exit | Verdict |
|---|---|:--:|---|
| Lint | `npm run lint` | 0 | **PASS** |
| Test | `npm run test` (`vitest run`) | 0 | **PASS** — 8 test files, 69 tests; `tests/cron-snapshot.test.ts` 13/13 (auth fail-closed + batch aggregation) |
| Build | `npm run build` (`next build`, keyless) | 0 | **PASS** — 12 pages; `/api/cron/snapshot` present in the route manifest as a dynamic function |
| Env preflight | `npm run check:env -- --prod` | 1 | **EXPECTED / working-as-designed** — not a defect |

**Why the env preflight exit 1 is correct, not a failure:** in a keyless local environment
the preflight *should* flag the prod-required vars that are intentionally unset locally —
`DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`CRON_SECRET`. It is a **deploy-time gate** that must exit **0** only when run against real
Vercel Production values. The keyless build gate is green *independently* (nothing in the app
graph imports the preflight script, and `CRON_SECRET` is read at request time, never at build).

> Invoke it as `npm run check:env -- --prod` (with the `--`). The form
> `npm run check:env --prod` lets npm swallow `--prod` before it reaches
> `scripts/check-env.mjs`, so strict mode never engages.

---

## Pre-production deploy checklist (still required)

RC2 clears **code readiness only**. Before promoting to Production, complete — at deploy
time — these four steps (detailed in [`docs/deployment.md` §4](../deployment.md)):

1. Configure real prod env in Vercel (Production scope, per the `docs/deployment.md` §1
   scope matrix). Generate `CRON_SECRET` with `openssl rand -hex 32`.
2. Run `npm run check:env -- --prod` against those real values and confirm exit **0**.
3. Apply migrations with `prisma migrate deploy` against `DIRECT_URL`
   (`0_init` + `1_perf_and_tenant_uniqueness`) — the explicit release step in
   [`docs/deployment.md` §4 step 6](../deployment.md).
4. Run the [`docs/deployment.md` §4 step 8](../deployment.md) smoke checks, then trigger
   the cron once manually (Vercel dashboard **"Run"**, or curl with the Bearer secret) and
   confirm snapshots land and the `{processed, succeeded, failed, skipped}` summary reports
   as expected. A missing/wrong `CRON_SECRET` yields `401` and no writes.

Reference: `docs/deployment.md` §3 (cron design), §4 (deploy checklist), §7 (RC2
verification status).
