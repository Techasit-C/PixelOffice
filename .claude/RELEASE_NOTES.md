# Release Notes — Pixel Office (Company-Level Governance)

Chronological, user-relevant changes. Newest first. Pixel Office does not yet use a
semantic version tag (`package.json` stays at `0.1.0`); releases are labelled by sprint.

> **Canonical location.** Company-level release log under `.claude/`. An app-scoped
> copy exists at `pixel-office/RELEASE_NOTES.md` with the same content from the app's
> point of view. Keep the two consistent.

---

## AI Company Operating System — Foundation (Sprint 5) — 2026-07-08

Commit **`db462a6`** on `main` (inside the `pixel-office/` repo). **Additive and
backward-compatible** — the existing office and Portfolio behavior, the Trading
endpoints, and all data contracts are unchanged. **Local only: not pushed to origin,
no deployment performed.**

### New routes

- **`/executive`** — Executive Dashboard: company-wide KPI overview composed
  client-side from existing authenticated endpoints. Mock figures are visibly tagged.
- **`/operations`** — AI Operations Center: full roster of every Claude Code agent on
  the host, error board, scope/source panel, search, and a "last edited" activity
  feed. Agents are shown as **installed, not running** (no execution telemetry).
- **`/mission-control`** — Mission Control: live TradingView signals and crypto
  prices, System Health, and Grid Bot / V2 widgets badged UI/mock. The Tasks panel is
  an honest **"no execution log yet"** placeholder.

### `/api/agents` hardening

Requests now flow `requireUser()` → per-user rate limit (`agentsRead` bucket) →
in-memory TTL cache. The `AgentsResponse` shape is unchanged, and the API still never
returns any agent's system prompt.

New optional configuration (documented in `.env.example`, safe to leave unset):

- `AGENTS_CACHE_TTL_MS` — TTL for the `/api/agents` in-memory cache. Default **`30000`** ms.
- `RATE_LIMIT_AGENTS_MAX` — per-user request cap for `/api/agents`. Default **`30`**
  per 60 s window (window from `RATE_LIMIT_WINDOW_MS`).

### Navigation

- New shared responsive top nav (`AppNav`) across the new surfaces. The legacy office
  page (`/`) keeps its own on-canvas ControlBar, now with an additive **"Views"**
  launcher linking the surfaces. No existing control was changed.
- Page-level auth now also protects `/executive`, `/operations`, `/mission-control`.

### Quality-gate evidence

QA gate **G5.3 PASSED**, security review **CLEAR** (no Critical/High/Medium), on
2026-07-08. Lint clean, `tsc --noEmit` clean, **98 tests pass (10 files)**,
`next build` produced **16/16 static pages**, and route smoke tests passed
(`/`, `/executive`, `/operations`, `/mission-control` → 200; `/api/agents` → 401
unauthenticated). Backward compatibility with the legacy office, Trading APIs, and the
`AgentsResponse` contract was confirmed.

### Known limitations (stated for clarity)

- Cache and rate limiter are per serverless instance (module memory), not shared.
- Agent `status` / activity derive from the agent `.md` file and its mtime, not live execution.
- Pre-existing GET endpoints (`company-status`, `affiliate`, `crypto-prices`,
  `tradingview-webhook`) remain unauthenticated — pre-existing, tracked separately.
