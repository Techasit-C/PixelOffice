# Project Status — Pixel Office (Company-Level Governance)

_Last updated: 2026-07-08 (end of Sprint 5)_

> **Canonical location.** This is the **company-level** status doc, read by the AI
> CEO under `.claude/` (see `AI_COMPANY_OPERATING_SYSTEM.md` priority list). An
> **app-scoped** copy exists at `pixel-office/PROJECT_STATUS.md` covering the same
> sprint from the app's point of view. Keep them consistent; if they diverge, this
> `.claude/` copy governs company decisions and the `pixel-office/` copy governs the
> app.

## Project

**Pixel Office — AI Company Operating System (foundation).** A Next.js 15 / React 19
web app that is growing from a single draggable pixel-art office canvas into a set of
read-only dashboard surfaces over the data the app already produces (portfolios,
company status, affiliate income, crypto prices, and the on-disk Claude Code agent
roster).

## Current milestone

**Sprint 5 — COMPLETE.** QA-passed (Gate **G5.3 PASS**), security review **CLEAR**.
Committed inside the `pixel-office/` git repository as commit **`db462a6`** on branch
`main`. **Local only — not pushed to origin. No deployment performed.**

> This commit bundled the Sprint 1–4 agents-feature work together with Sprint 5 into
> a single "foundation" commit. Prior history had only 2 commits, so history
> granularity is coarse (tracked as R-04 in `RISK_REGISTER.md`).

## Verified quality gates (2026-07-08)

- `npm run lint` — clean
- `npx tsc --noEmit` — clean
- `npm test` — **98 tests pass across 10 files**
- `npm run build` — **16 / 16 static pages** generated
- Dev route smoke test: `/`, `/executive`, `/operations`, `/mission-control` → **200**
- `/api/agents` → **401** when unauthenticated

## Shipped surfaces (Sprint 5)

- **Executive Dashboard** (`/executive`) — company-wide KPI overview
- **AI Operations Center** (`/operations`) — full Claude Code agent roster
- **Mission Control** (`/mission-control`) — signals, prices, system health, tasks placeholder
- **`/api/agents` hardening** — in-memory TTL cache + per-user rate limiting
- **Shared infra** — `PixelCard`, `AppNav`, `PageShell`, `use-json-poll`
- **Additive ControlBar "Views" launcher** — links the new surfaces; no existing control changed
- **Middleware** — page-level auth now also gates the 3 new routes

## Backward compatibility (confirmed)

- Legacy `/` (1700×1150 draggable canvas) — **unchanged**
- Trading `/api/*` — **untouched**
- `AgentsResponse` contract — **unchanged**
- No agent system-prompt body is exposed by any endpoint

## Known caveats (honest — not defects introduced by Sprint 5)

- The in-memory cache and rate limiter live in module memory, so on serverless each
  instance keeps its own copy. Effective global rate limit ≈ `configured limit ×
  concurrent instances`; counters/cache reset on scale-down. (R-01)
- Agent `status` is **file-derived** (`available` / `error`) and `activity` is the
  agent `.md` file's modification time — **"last edited", NOT live execution state.**
  Agents are **installed, not running.** (R-05)
- Some pre-existing GET endpoints (`/api/company-status`, `/api/affiliate`,
  `/api/crypto-prices`, `/api/tradingview-webhook`) are **unauthenticated**. This
  **predates Sprint 5** and is tracked separately. (R-02)
- Mission Control **Tasks** is an honest **"no execution log yet"** placeholder — not
  fabricated run data. (R-05)

## Repository

**Unified — single git root at `Ai Agent/`.** The former nested-repo situation is
resolved: `T:\Claude Code\Ai Agent` is now the SINGLE repository root. `pixel-office`
history was merged under the `pixel-office/` subpath via **Option B (built-in git
subtree merge)** — merge commit **`44b3857`** (two parents `e9f5084` + `db462a6`).

- **History preserved:** all 3 original pixel-office SHAs reachable — `db462a6`,
  `913eb08`, `70c6d2b`.
- **Tracked:** `.claude/` = 36 files (governance + 26 agents); `pixel-office/` = 162
  files. File-set vs pre-migration backup: **742 = 742, zero files lost.**
- **Archives kept (not deleted):** nested `pixel-office/.git` → `pixel-office/.git.bak`
  (full-history archive); `--all` bundle at `T:\Claude Code\pixel-office-ALL.bundle`;
  folder snapshot `T:\Claude Code\Ai Agent__BACKUP_2026-07-08`.
- **No push, no deploy.** Current branch `master`.

**Decision (2026-07-08):** Option B repo unification approved and executed by CEO. Two
honest follow-up notes (NOT defects):
1. `git log --follow -- pixel-office/<file>` returns empty across the merge boundary —
   a known git `--follow` limitation over a prefix / `-s ours` merge, NOT data loss.
   History is fully reachable via plain `git log` and the second-parent lineage.
   Accepted as the documented Option B trade-off.
2. `pixel-office/package.json` carries a pre-existing uncommitted working-tree edit
   (`"dev": "next dev"` vs committed `"next dev --turbopack"`) that predates the
   migration and was intentionally left uncommitted, awaiting a separate dev decision.
   NOT a migration artifact. (Tracked as R-07.)

## Deployment

**NOT started** — explicitly out of scope by CEO directive. Remains in the deferred
backlog (see `ROADMAP.md`).

## Cross-references

- `ROADMAP.md` — completed + candidate + deferred work
- `RELEASE_NOTES.md` — Sprint 5 changelog and evidence
- `CHANGE_REQUESTS.md` — open CRs (governance location, version-control scope)
- `RISK_REGISTER.md` — live risks R-01 … R-07 (R-03 CLOSED after repo unification)
