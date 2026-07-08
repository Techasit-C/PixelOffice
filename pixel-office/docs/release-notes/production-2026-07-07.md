# Release Notes — Production go-live (2026-07-07)

**Date:** 2026-07-07
**Status:** **Production Ready (Conditional)** — live and verified for controlled/personal
use; public/multi-user launch is gated on live Clerk keys (see Conditions).
**Production URL:** https://pixel-office-mauve.vercel.app
**Change requests shipped:** CR-DEPLOY-01 (daily snapshot cron) + CR-AUTH-01 (Clerk client
sign-in surface).

This is the **first production deployment** of pixel-office — executed and verified
end-to-end this session (devops-engineer + qa-engineer), following the deploy checklist in
[`docs/deployment.md` §4](../deployment.md). The full witnessed step-by-step record lives in
[`docs/deployment.md` §8](../deployment.md).

---

## Target

| Item | Value |
|---|---|
| Vercel project | `REALTITLE` (plan **Pro**) |
| Production URL | https://pixel-office-mauve.vercel.app |
| Root Directory | `pixel-office` · production branch `main` |
| Database | Neon PostgreSQL, region AWS `us-east-1` (matches Vercel `iad1`) |
| Auth | Clerk **TEST/Development** instance (`pk_test_`/`sk_test_`, "Option B interim") |
| Prices | Finnhub (live equity/ETF) via `FINNHUB_API_KEY`; CoinGecko key skipped |

---

## What went live

### CR-DEPLOY-01 — Daily portfolio-valuation snapshot cron

The daily "value every portfolio" job (RC2-signed for code-readiness; see
[`RC2.md`](./RC2.md)) is now registered and running in production:

- Vercel → **Cron Jobs** shows `/api/cron/snapshot @ 0 22 * * *` (22:00 UTC, after US close).
- `POST /api/cron/snapshot` bearer-auths against `CRON_SECRET`, values every portfolio
  **sequentially**, skips empty portfolios, and returns a
  `{processed, succeeded, failed, skipped, failures?}` summary (idempotent per UTC day).

### CR-AUTH-01 — Clerk client sign-in surface + `/portfolio` protection

Raised **mid-deploy**: the go-live smoke test confirmed signed-out `/api/portfolios`
returned 401, but the app had **no client-facing way to sign in** — server-side Clerk auth
existed with no sign-in UI and no page-level route protection. Fixed and redeployed.

- **Created:** `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx`
  (embedded Clerk auth widgets, dynamic routes), `components/auth/HeaderAuth.tsx`
  (sign-in link when signed out, `<UserButton>` when signed in).
- **Edited:** `app/layout.tsx` (conditional, keyless-safe `<ClerkProvider>`), `middleware.ts`
  (`createRouteMatcher(["/portfolio(.*)"])` + `auth.protect()`, with `/api/**` excluded so
  API stays JSON-401), `components/portfolio/PortfolioPageClient.tsx` (mounts `HeaderAuth`),
  `lib/portfolio-client/api.ts` (real "please sign in" 401 copy replacing a stale dev string).
- **Unchanged:** server-side `requireUser()` and the 401/404 tenancy behavior.
- This Clerk 7.x uses `<Show when="signed-in|signed-out">` — **not** the older
  `<SignedIn>`/`<SignedOut>`.

---

## Verification evidence

### Code gates (keyless local, qa-engineer)

| Gate | Command | Exit |
|---|---|:--:|
| Lint | `npm run lint` | **0** |
| Typecheck | `npx tsc --noEmit` | **0** |
| Test | `npm run test` (`vitest run`) | **0** — 69 tests / 8 files (`tests/cron-snapshot.test.ts` 13/13) |
| Build | `npm run build` (keyless) | **0** — sign-in/sign-up emit as dynamic routes; `/portfolio` builds |
| Env preflight | `npm run check:env -- --prod` | **1** — EXPECTED keyless (deploy-time gate; not a defect) |

### Deploy-time (against real Vercel Production values)

- `npm run check:env -- --prod` = **0**.
- `prisma migrate deploy` on `DIRECT_URL` = **0** (`0_init` + `1_perf_and_tenant_uniqueness`).
- `prisma migrate status` = **"Database schema is up to date!"** — **8 tables** live.
- Production build ran `prisma generate && next build`; deployment **Ready**, domain live.

### Production smoke (live URL) — all PASS

1. App loads.
2. `GET /api/company-status` → **200** (`holdingsSource:"mock"`).
3. Signed-out `GET /api/portfolios` → **401**.
4. Signed-in via Clerk → `GET /api/portfolios` → **200**.
5. `POST /api/portfolios` → **201**, then `POST /api/portfolios/{id}/performance` → **201**
   `{ok:true, capturedAt:"2026-07-07T00:00:00.000Z"}`.

> **Operator note (check 5):** the create response nests the new id as **`.portfolio.id`**
> (`{ portfolio: { id } }`), not top-level `.id`. Reading `.id` makes the follow-up POST hit
> an `undefined` path and appear to 404 — the route exists and returns 201. Grab
> `.portfolio.id`.

### Cron verification

- Unauthenticated `POST /api/cron/snapshot` → **401 `{"error":"Unauthorized"}`**.
- Authorized `POST` → **200**, `{processed:2, succeeded:0, failed:0, skipped:2}` — both
  portfolios empty and skipped **by design** (`_count.holdings === 0`); no failures.

---

## Conditions (before a PUBLIC / multi-user launch)

- **Clerk is on TEST keys (Option B interim).** `pk_test_`/`sk_test_` = a Clerk Development
  instance. Adequate for controlled/personal use, **not** production-grade for a public
  launch. Attach a custom domain + a verified Clerk **Production** instance and swap to
  `pk_live_`/`sk_live_` before opening to multiple/public users.
- **R3 (sequential batch scaling)** — open-monitor. The cron values portfolios sequentially;
  wall clock grows with portfolio count (`maxDuration=60`; Pro ceiling 300s).
- **R6 (portfolios empty)** — informational. Snapshots skip empty portfolios; the series is
  meaningful once holdings are added.

---

## Post-go-live fix — CR-UI-01 (same day)

**Create-portfolio modal clipped in the zero-portfolios empty state.** Found during post-go-live
live testing: a signed-in user with **zero portfolios** clicked **"+ พอร์ตใหม่"** and nothing
happened — the Network tab showed **no `POST /api/portfolios`**, so the button looked dead.

- **Root cause:** the empty state renders `PortfolioSelector` inside a `<Panel>` that applies
  `clip-path` + `overflow-hidden` (`components/portfolio/ui.tsx`); the `<Modal>` was an in-tree
  `position: fixed` overlay with **no portal**. A `clip-path` on an ancestor clips even
  `position: fixed` descendants, so the modal opened but was clipped inside the panel and
  unreachable — the user could never submit, so no `POST` fired. The button/handler/create-call
  wiring was already correct and is unchanged. Users with **≥1 portfolio were unaffected** (there
  the modal sat at page root).
- **Fix (one file):** `components/portfolio/ui.tsx` — portal the `Modal` overlay to
  `document.body` via `createPortal` (`react-dom`), with a client-mount gate so SSR / keyless
  builds never touch `document`. **No server, API, route, or response-shape change.**
- **Gates (all exit 0):** `npm run lint` = **0**; `npx tsc --noEmit` = **0**; `npm run test` =
  **0** (10 files, **98 passed** — no regressions); keyless `npm run build` = **0**.
- **Live-verified after redeploy** (commit `09687d5`, merged to `main`): zero-portfolio user
  clicks **"+ พอร์ตใหม่"** → modal centers over the full viewport → submit →
  `POST /api/portfolios` → **201** → new portfolio appears and is auto-selected; header button
  (≥1 portfolio) still works. Full record: [`docs/deployment.md` §6, §8](../deployment.md).

---

## References

- Deploy checklist: [`docs/deployment.md` §4](../deployment.md).
- Full witnessed go-live record: [`docs/deployment.md` §8](../deployment.md).
- Cron design & change-request status: [`docs/deployment.md` §3, §6](../deployment.md).
- RC2 (code-readiness sign-off for CR-DEPLOY-01): [`RC2.md`](./RC2.md).
- Auth architecture reconciliation (Auth.js → Clerk): [`docs/portfolio-architecture.md` §3.2](../portfolio-architecture.md).
