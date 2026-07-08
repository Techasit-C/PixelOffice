# Roadmap — Pixel Office (Company-Level Governance)

Tracks direction and the backlog of deferred work. Backlog and candidate items are
**recorded, not scheduled** — no dates or committed sprints are implied.

> **Canonical location.** This is the **company-level** roadmap under `.claude/`. An
> **app-scoped** copy exists at `pixel-office/ROADMAP.md` covering the same work from
> the app's point of view. Keep the two consistent.

## Direction

Pixel Office is evolving into an **AI Company Operating System**: read-only dashboard
surfaces layered additively over data the app already produces, while preserving the
original Pixel Office architecture and the Portfolio and Trading modules.

## Completed

### Sprint 1–4 — Real agents feature ✅

Load Claude Code agents from both `.claude/agents` and `~/.claude/agents`, group them
by team, and surface them in a grouped-by-team UI. **DONE.** (Bundled into commit
`db462a6` alongside Sprint 5 — see `PROJECT_STATUS.md`.)

### Sprint 5 — AI Company OS foundation ✅ (committed `db462a6`)

Three read-only surfaces (`/executive`, `/operations`, `/mission-control`) plus
`/api/agents` TTL cache + per-user rate limiting, shared UI/nav/infra, and middleware
gating the new routes. QA gate **G5.3 PASSED**, security review **CLEAR**. See
`RELEASE_NOTES.md` and `PROJECT_STATUS.md` for evidence. **Local commit — not pushed,
not deployed.**

## Candidate

### Sprint 6 — PROPOSED · AWAITING APPROVAL · NOT STARTED

> **Implementation is BLOCKED pending user approval of the plan.** No dates are
> scheduled. Candidate scope only:

- **(a) Distributed cache / rate limiter** — replace the per-instance in-memory cache
  and rate limiter with a shared store (e.g. Redis/Upstash) so limits and cached
  rosters are consistent across serverless instances. Addresses R-01.
- **(b) Execution telemetry for real Tasks** — persist agent run events so Mission
  Control **Tasks** shows actual activity instead of the current "no execution log
  yet" placeholder. Addresses R-05.
- **(c) Auth on the pre-existing unauthenticated GET endpoints** —
  `/api/company-status`, `/api/affiliate`, `/api/crypto-prices`,
  `/api/tradingview-webhook`. Addresses R-02.

## Deferred backlog (unscheduled)

- **Deployment sprint.** No deployment work has been done; explicitly out of scope so far.
- **Keep `lib/agents/teams.ts` in sync with `CLAUDE.md`.** Ensure the team lists the
  API groups agents into stay aligned with the canonical team roster in the project
  `CLAUDE.md`.
- **Version-control the parent `Ai Agent/` folder.** Currently only `pixel-office/` is
  a git repo; `.claude/` governance + agent definitions + `portfolio_stress_test/`
  are unversioned. See `CHANGE_REQUESTS.md` (CR-REPO-01) and `RISK_REGISTER.md` (R-03).
