# Changelog

All notable changes to **pixel-office** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **CR-DEPLOY-01 — Daily portfolio-valuation snapshot cron** reached
  **RC2 (2026-07-07)**, signed off for **code-readiness**.
  - `POST /api/cron/snapshot` (`app/api/cron/snapshot/route.ts`, `runtime = "nodejs"`):
    a system job that loads every portfolio, skips empty ones
    (`_count.holdings === 0`), and captures one idempotent snapshot per portfolio
    **sequentially**.
  - Fail-closed `CRON_SECRET` bearer auth (constant-time compare; an unset/empty
    secret rejects). No Clerk path — the shared secret is the only gate. Any failure
    returns a generic `401`.
  - Batch orchestration factored into `lib/cron/snapshot-batch.ts`
    (`authorizeCron`, `runSnapshotBatch`); a single portfolio failure never aborts the
    batch, and the response is a `{processed, succeeded, failed, skipped, failures?}`
    summary with secrets redacted from error strings.
  - `vercel.json` cron wiring: schedule `0 22 * * *` (22:00 UTC, after US close) on
    `/api/cron/snapshot`, plus `functions."app/api/cron/snapshot/route.ts".maxDuration = 60`.

### Verification (RC2, 2026-07-07)

- `npm run lint` — exit **0** (PASS).
- `npm run test` (`vitest run`) — exit **0** (PASS): 8 test files, 69 tests;
  `tests/cron-snapshot.test.ts` 13/13 (fail-closed auth + batch aggregation).
- `npm run build` (`next build`, keyless) — exit **0** (PASS): 12 pages;
  `/api/cron/snapshot` present in the route manifest as a dynamic function.
- `npm run check:env -- --prod` — exit **1**, EXPECTED in a keyless local environment
  (prod-required vars intentionally unset). This is a deploy-time gate that must pass
  (exit 0) only against real Vercel Production values — not a code defect.

### Not yet released

- RC2 is **code-readiness only**. Production deploy still requires, at deploy time:
  real prod env in Vercel, `check:env -- --prod` = 0 against those values,
  `prisma migrate deploy` on `DIRECT_URL`, and the `docs/deployment.md` §4 smoke checks
  plus one manual cron "Run". See `docs/release-notes/RC2.md` and `docs/deployment.md` §7.
