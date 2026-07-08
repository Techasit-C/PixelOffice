# Project Status — Pixel Office

_Last updated: 2026-07-08 (end of Sprint 5)_

## What Pixel Office is

Pixel Office is the Next.js 15 / React 19 web app for the "AI Company" project. It
started as a single draggable pixel-art office canvas (`/`) and a Portfolio
management module (`/portfolio`), and is now growing into an **"AI Company
Operating System"**: a set of read-only dashboard surfaces over the data the app
already produces (portfolios, company status, affiliate income, crypto prices, and
the on-disk Claude Code agent roster).

Sprint 5 added three of those surfaces. It was **additive only** — no existing
Pixel Office behavior, no Trading endpoint, and no data contract was changed.

## Current state (as of Sprint 5)

| Area | Status |
|---|---|
| Legacy office canvas (`/`, 1700×1150 draggable) | Shipped, unchanged in Sprint 5 |
| Portfolio module (`/portfolio` + `/api/portfolios/*`) | Shipped, unchanged in Sprint 5 |
| Executive Dashboard (`/executive`) | **Shipped in Sprint 5** |
| AI Operations Center (`/operations`) | **Shipped in Sprint 5** |
| Mission Control (`/mission-control`) | **Shipped in Sprint 5** |
| `/api/agents` caching + per-user rate limiting | **Shipped in Sprint 5** |
| Deployment / hosting | **Not done** — explicitly out of scope, still backlog |

App version in `package.json` is `0.1.0` and was **not** bumped in Sprint 5 (no
release/versioning scheme is in use yet). "Sprint 5" is the label used across these
docs and `RELEASE_NOTES.md`.

## Sprint 5 QA sign-off

Gate **G5.3 PASSED** and security review **CLEAR** on **2026-07-08**. Evidence:

- `npm run lint` — clean
- `npx tsc --noEmit` — clean
- `npm test` — 98 tests pass across 10 files
- `npm run build` — 16 / 16 static pages generated
- Dev server smoke test: `/`, `/executive`, `/operations`, `/mission-control` all
  return `200`; `/api/agents` returns `401` when unauthenticated
- Backward compatibility confirmed: legacy `/` draggable canvas unchanged, Trading
  `/api/*` untouched, and the `AgentsResponse` contract unchanged
- Security review: no Critical / High / Medium findings

## Known limitations carried forward

These are documented honestly and are **not** defects introduced by Sprint 5:

- The in-memory agents cache and the rate limiter both live in module memory, so on
  serverless each instance keeps its own copy — the effective global rate limit is
  `configured limit × concurrent instances`, and counters/cache reset on scale-down.
- Agent `status` is derived from the agent's on-disk `.md` file (`available` /
  `error`); `activity` is the file's modification time ("last edited"). Neither is
  live execution state — the agents are **installed, not running**.
- Some pre-existing GET endpoints (`/api/company-status`, `/api/affiliate`,
  `/api/crypto-prices`, `/api/tradingview-webhook`) are unauthenticated. This
  predates Sprint 5 and is tracked as a separate follow-up (see `ROADMAP.md`).
- `/api/agents` never returns the body (system prompt) of any agent `.md` file.

See `FEATURE_REGISTRY.md` for the per-feature detail, `RELEASE_NOTES.md` for the
Sprint 5 changelog, and `ROADMAP.md` for deferred work.
