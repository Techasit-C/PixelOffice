# Roadmap — Pixel Office

Tracks the direction of the app and the backlog of deferred work. Backlog items are
**recorded, not scheduled** — no dates or committed sprints are implied here.

## Direction

Pixel Office is evolving into an **"AI Company Operating System"**: read-only
dashboard surfaces layered additively over the data the app already produces, while
preserving the original Pixel Office architecture and the Portfolio and Trading
modules.

## Completed

### Sprint 5 — AI Company OS foundation ✅ (2026-07-08)

Shipped and verified (QA gate G5.3 PASSED, security review CLEAR). See
`RELEASE_NOTES.md` and `FEATURE_REGISTRY.md` for detail.

- Executive Dashboard (`/executive`)
- AI Operations Center (`/operations`)
- Mission Control (`/mission-control`)
- Shared UI/nav/infra (`PixelCard`, `AppNav`, `PageShell`, `useJsonPoll`) and the
  additive "Views ▾" launcher
- `/api/agents` hardening: in-memory TTL cache + per-user rate limiting
- Optional config: `AGENTS_CACHE_TTL_MS`, `RATE_LIMIT_AGENTS_MAX`

## Backlog (deferred — not scheduled)

These were explicitly deferred during Sprint 5 and are captured for future planning:

- **Deployment / hosting.** Explicitly out of scope for Sprint 5. No deployment work
  has been done.
- **Shared / distributed cache + rate limiter.** Replace the per-instance in-memory
  cache (`lib/agents/agents-cache.ts`) and rate limiter (`lib/api/rate-limit.ts`)
  with a shared store (e.g. Redis/Upstash) so limits and cached rosters are consistent
  across serverless instances. The `RateLimiter` interface already allows this swap
  without touching route handlers.
- **Execution telemetry / task persistence.** A real source of running-task data so
  the Mission Control **Tasks** panel can show actual activity instead of the current
  "no execution log yet" placeholder. This would also let agent status/activity
  reflect real execution rather than file mtime.
- **Auth for the pre-existing unauthenticated GET endpoints** (`/api/company-status`,
  `/api/affiliate`, `/api/crypto-prices`, `/api/tradingview-webhook` GET). Pre-existing
  gap, tracked separately from Sprint 5.
- **Keep `lib/agents/teams.ts` in sync with `CLAUDE.md`.** Ensure the team lists the
  API groups agents into stay aligned with the canonical team roster defined in the
  project `CLAUDE.md`.
