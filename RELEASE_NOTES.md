# Release Notes — Pixel Office

Chronological, user-relevant changes. Newest first. Pixel Office does not yet use a
semantic version tag (`package.json` stays at `0.1.0`); releases are labelled by
sprint.

---

## Sprint 5 — "AI Company Operating System" (foundation) — 2026-07-08

Pixel Office begins evolving from a single office canvas into an **AI Company
Operating System**: read-only dashboard surfaces over data the app already produces.
This release is **additive only** — the existing office and Portfolio behavior, the
Trading endpoints, and all data contracts are unchanged and backward compatible.
**No deployment work** is included.

### New pages

- **Executive Dashboard (`/executive`)** — company-wide KPI overview (portfolio value
  and unrealized PnL, DCA progress toward ฿1,000,000, affiliate income, BTC asset
  value, and AI workforce headcount). KPIs are composed client-side from existing
  authenticated endpoints. Mock figures are visibly tagged as mock.
- **AI Operations Center (`/operations`)** — full roster of every Claude Code agent on
  the host: summary strip, team rosters, error board, scope/source panel, search
  filter, and an activity feed of the most recently edited agent files. The activity
  feed is labelled **"last edited"** and agents are shown as **installed, not
  running** — there is no execution telemetry.
- **Mission Control (`/mission-control`)** — live TradingView signals and crypto
  prices, a System Health panel, and Grid Bot / V2 Trading widgets that stay badged
  **UI / mock** (there is no exchange grid-bot API). The Tasks panel is an honest
  "no execution log yet" placeholder, not fabricated data.

### Navigation

- New shared responsive top nav (`AppNav`) across the new surfaces, with a mobile
  hamburger menu. The legacy office page (`/`) keeps its own on-canvas ControlBar.
- New **"Views ▾"** launcher added to the office ControlBar linking to the four
  surfaces. No existing control was changed.
- Page-level auth now also protects `/executive`, `/operations`, and
  `/mission-control` (same mechanism already used for `/portfolio`).

### Backend

- **`/api/agents` now caches and rate-limits.** Requests flow
  `requireUser()` → per-user rate limit (`agentsRead` bucket) → in-memory TTL cache.
  The response shape (`AgentsResponse`) is unchanged, and the API still never returns
  any agent's system prompt.

### New configuration (optional)

Documented in `.env.example`; both have sane defaults and are safe to leave unset.

- `AGENTS_CACHE_TTL_MS` — TTL for the `/api/agents` in-memory cache. Default
  `30000` ms.
- `RATE_LIMIT_AGENTS_MAX` — per-user request cap for `/api/agents`. Default `30` per
  60 s window (window from `RATE_LIMIT_WINDOW_MS`).

### Known limitations (unchanged behavior, stated for clarity)

- The agents cache and rate limiter are per serverless instance (module memory), not
  shared across instances.
- Agent `status` / activity are derived from the agent `.md` file and its mtime, not
  from live execution.
- Some pre-existing GET endpoints (`company-status`, `affiliate`, `crypto-prices`,
  `tradingview-webhook`) remain unauthenticated — pre-existing, tracked separately,
  not part of this release.

### Quality gate

QA gate **G5.3 PASSED**, security review **CLEAR** (no Critical/High/Medium), on
2026-07-08. Lint clean, `tsc --noEmit` clean, 98 tests pass (10 files),
`next build` produced 16/16 static pages, and route smoke tests passed
(`/`, `/executive`, `/operations`, `/mission-control` → 200; `/api/agents` → 401
unauthenticated). Backward compatibility with the legacy office, Trading APIs, and
the `AgentsResponse` contract was confirmed.
