# Changelog

All notable changes to **pixel-office** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing pending. Public/multi-user launch is tracked as a condition on the 2026-07-07
release (swap Clerk TEST keys → live production instance) rather than as a code change.

## [2026-07-07] — First production deploy · **Production Ready (Conditional)**

First production deployment of pixel-office, executed and verified end-to-end
(devops-engineer + qa-engineer). Live at https://pixel-office-mauve.vercel.app
(Vercel project `REALTITLE`, Pro plan, Neon `us-east-1`). Two change requests shipped
together. Full witnessed record: `docs/deployment.md` §8; release note
`docs/release-notes/production-2026-07-07.md`.

### Added

- **CR-DEPLOY-01 — Daily portfolio-valuation snapshot cron** — **deployed & verified in
  production** (was RC2 code-readiness on the same date).
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
  - **In production:** Vercel Cron Jobs shows `/api/cron/snapshot @ 0 22 * * *`;
    unauthenticated `POST` → **401 `{"error":"Unauthorized"}`**; authorized `POST` →
    **200** `{processed:2, succeeded:0, failed:0, skipped:2}` (both portfolios empty,
    skipped by design — healthy, no failures).

- **CR-AUTH-01 — Clerk client sign-in surface + `/portfolio` route protection** — raised
  mid-deploy when the smoke test found the app had server-side Clerk auth but **no way for
  a user to sign in** (no sign-in UI, no page-level protection). Uses Clerk 7.x
  (`<Show when="signed-in|signed-out">`, not the older `<SignedIn>`/`<SignedOut>`).
  - Created `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx`
    (embedded Clerk auth widgets; build as dynamic routes), and
    `components/auth/HeaderAuth.tsx` (sign-in link when signed out, `<UserButton>` when
    signed in; gated on the inlined publishable key so keyless dev renders nothing).
  - `middleware.ts`: `createRouteMatcher(["/portfolio(.*)"])` + `auth.protect()` redirects
    signed-out visitors of `/portfolio` to sign-in. **`/api/**` is excluded** so API
    handlers keep answering JSON **401** (not an HTML redirect).
  - `app/layout.tsx`: `<ClerkProvider>` mounted only when Clerk keys are present
    (keyless-boot invariant preserved).
  - `components/portfolio/PortfolioPageClient.tsx` mounts `HeaderAuth`;
    `lib/portfolio-client/api.ts` replaces the stale "Clerk ยังไม่ตั้งค่าใน dev" 401 string
    with a real "please sign in" message.
  - Server-side `requireUser()` and the existing 401/404 tenancy behavior are unchanged.

### Changed

- `docs/portfolio-architecture.md`: the original **Auth.js v5** auth decision (§3.2) is
  marked **SUPERSEDED by Clerk** with a dated note referencing CR-AUTH-01. The historical
  Auth.js text/rationale is preserved for context; the app ships Clerk.

### Fixed

- **CR-UI-01 — Create-portfolio modal clipped in the zero-portfolios empty state** — **shipped
  same day, after the initial go-live**, and live-verified after redeploy. Found during
  post-go-live live testing: a signed-in user with **zero portfolios** clicked
  **"+ พอร์ตใหม่"** and nothing happened — the Network tab showed **no `POST /api/portfolios`**,
  so the button looked dead.
  - **Root cause (not a wiring bug):** the empty state renders `PortfolioSelector` inside a
    `<Panel>` that applies `clip-path` + `overflow-hidden`
    (`components/portfolio/ui.tsx`). The `<Modal>` was an in-tree `position: fixed` overlay
    with **no portal**. A `clip-path` on an ancestor clips even `position: fixed` descendants,
    so the create modal **did** open but was clipped inside the panel and unreachable — the
    user could never submit, so no `POST` fired. The button/handler/create-call wiring
    (`PortfolioSelector.tsx`: `onClick` → modal → `portfolioApi.create` → `POST`, reads the
    nested `res.portfolio.id`, `onCreated` → refetch + `setSelectedId`) was already **correct
    and is unchanged**. Users with **≥1 portfolio were unaffected** — there the header modal
    sat at page root, outside any clipping ancestor.
  - **Fix (one file):** `components/portfolio/ui.tsx` — the `Modal` overlay is now portaled to
    `document.body` via `createPortal` (`react-dom`), gated on a client mount flag
    (`useState` `mounted` + `useEffect(() => setMounted(true), [])`; early
    `if (!open || !mounted) return null;`) so SSR / keyless builds never touch `document`.
    **No server, API, route, or response-shape change.**
  - **Verified (all gates exit 0):** `npm run lint` = **0**; `npx tsc --noEmit` = **0**;
    `npm run test` = **0** (10 files, 98 passed — no regressions); keyless
    `npm run build` = **0** (sign-in/sign-up stay dynamic, `/portfolio` builds).
  - **Live-verified after redeploy:** a signed-in user with zero portfolios clicks
    **"+ พอร์ตใหม่"** → modal now centers over the full viewport → submit →
    `POST /api/portfolios` fires → **201** → the new portfolio appears and is auto-selected.
    The header button (≥1 portfolio) still works. Commit `09687d5`; merged to `main` and
    redeployed.

### Verification (2026-07-07)

- **Code gates (keyless local, qa-engineer):** `npm run lint` = **0**; `npx tsc --noEmit`
  = **0**; `npm run test` (`vitest run`) = **0** (69 tests / 8 files;
  `tests/cron-snapshot.test.ts` 13/13); keyless `npm run build` = **0** (sign-in/sign-up
  emit as dynamic routes; `/portfolio` builds). `npm run check:env -- --prod` = **1** is
  the EXPECTED keyless result (prod-required vars intentionally unset) — a deploy-time gate,
  not a defect.
- **Deploy-time (against real prod values):** `npm run check:env -- --prod` = **0**;
  `prisma migrate deploy` on `DIRECT_URL` = **0** (`0_init` + `1_perf_and_tenant_uniqueness`,
  8 tables); `prisma migrate status` = "Database schema is up to date!".
- **Production smoke (live URL):** app loads; `GET /api/company-status` → 200
  (`holdingsSource:"mock"`); signed-out `GET /api/portfolios` → 401; signed-in → 200;
  `POST /api/portfolios` → 201, then `POST /api/portfolios/{id}/performance` → 201
  `{ok:true, capturedAt:"2026-07-07T00:00:00.000Z"}`.

### Conditions (pre-public-launch gate)

- **Clerk runs on TEST/Development keys** (`pk_test_`/`sk_test_`, "Option B interim"). Fine
  for controlled/personal use; **NOT production-grade for a public/multi-user launch**. That
  requires a custom domain + a verified Clerk **Production** instance (`pk_live_`/`sk_live_`).
- Open-monitor: **R3** sequential batch scaling; **R6** portfolios empty (snapshots become
  meaningful once holdings are added).
