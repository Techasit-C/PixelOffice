# Roadmap — Pixel Office

Tracks the direction of the app and the backlog of deferred work. Backlog items are
**recorded, not scheduled** — no dates or committed sprints are implied here.

## Direction

Pixel Office is evolving into an **"AI Company Operating System"**: read-only
dashboard surfaces layered additively over the data the app already produces, while
preserving the original Pixel Office architecture and the Portfolio and Trading
modules.

## Completed

### AI Trading Bot — Phase 3, Deterministic Backtesting ✅ (2026-07-16)

**Status: Accepted.** All automated gates pass (full test suite, clean
typecheck, clean lint, clean build, static safety scan), and the
authenticated interactive acceptance checklist
(`docs/superpowers/specs/2026-07-15-trading-bot-phase3-acceptance-checklist.md`)
was completed by the repository owner — all items passed, including
navigation between Trading Bot and Backtest, a real MEXC-backed run,
immutable result/config binding, stale-result clearing after input changes,
client-side validation without unnecessary API requests, hand-verified trade
accounting, CSV validation, cancellation behavior, invalid-input rejection, a
clean application console, and confirmation that no live execution
capability is reachable.

Deterministic, long-only, single-symbol backtesting over the accepted Phase 2
signal engine, per the approved design
(`docs/superpowers/specs/2026-07-15-trading-bot-phase3-backtesting-design.md`)
and implementation plan
(`docs/superpowers/plans/2026-07-15-trading-bot-phase3-backtesting.md`). See
`FEATURE_REGISTRY.md` for full detail.

- Reuses the real, unmodified `buildSignalFromCandles` as the simulation
  loop's injected signal provider — proven look-ahead-free by a dedicated
  future-independence invariant suite.
- Risk-based sizing hard-capped at cash and a 0.5% risk budget, corrected
  decision-bar/tradable-bar boundary handling, an empirically-verified MEXC
  pagination contract, a self-imposed 2 MB response cap, and a schema-aware,
  trade-ledger-only CSV export (monetary/quantity/timestamp columns stay
  numeric; only free-text columns get spreadsheet-formula-injection
  protection).
- Authenticated, rate-limited (`backtestRun` bucket), strictly-whitelisted
  API route with a shared-AbortController internal deadline that actually
  stops in-flight network requests, not just the response.
- Visible cross-navigation between `/trading-bot` and `/trading-bot/backtest`;
  stale-result clearing and client-side validation (with focus management) on
  the backtest form.
- **Not included yet (deferred, see Backlog):** database persistence,
  parameter optimization, leverage/margin/executable shorts, live trading,
  broker credentials, bot automation — unchanged from Phase 1/2. Phase 4
  requires a separate design and explicit approval before work begins.

### AI Trading Bot — Phase 2, Extended Signal Analysis ✅ (2026-07-14)

**Status: Accepted.** All automated gates pass (300/300 tests, clean
typecheck, clean lint, clean build, static safety scan), and the
authenticated interactive acceptance checklist
(`docs/superpowers/specs/2026-07-14-trading-bot-phase2-acceptance-checklist.md`)
was completed by the repository owner — all 7 items passed, no unexpected
browser-console errors.

MACD, Bollinger Bands, multi-timeframe (1h/1d) confirmation, corrected
closed-candle/staleness detection, in-flight candle-request coalescing, and
deterministic plain-language explanations, per the approved design
(`docs/superpowers/specs/2026-07-14-trading-bot-phase2-signals-design.md`)
and implementation plan
(`docs/superpowers/plans/2026-07-14-trading-bot-phase2-signals.md`). See
`FEATURE_REGISTRY.md` for full detail.

- Enrichment is an additive pass that can change only confidence/reasoning —
  `detectSetup()` is provably unchanged (pinned baseline snapshot).
- One existing engine fixture's final signal intentionally moved from LONG to
  WAIT (a documented confidence-gate crossing, not a defect) — see
  `tests/trading-signals-engine.test.ts` for the full point-by-point
  breakdown. All 7 other fixtures unchanged.
- `SignalEngineStrategy` now uses the same three-timeframe view as the
  displayed signal (order-time parity fix) without changing its public
  interface or the `SourceSignal` type.
- **Not included yet (deferred, see Backlog):** backtesting, database
  persistence, the full risk-rule set, live trading, broker credentials,
  bot automation — unchanged from Phase 1. Phase 3 requires a separate
  design and explicit approval before work begins.

### AI Trading Bot — Phase 1 ✅ (2026-07-14)

**Status: Accepted.** All automated gates pass (218/218 tests, clean typecheck,
clean lint, clean build, static safety scan), and the authenticated interactive
acceptance checklist
(`docs/superpowers/specs/2026-07-14-trading-bot-phase1-acceptance-checklist.md`)
was completed by the repository owner — all 9 items passed, no unexpected
browser-console errors.

Interfaces + mock broker, per the approved design
(`docs/superpowers/specs/2026-07-14-trading-bot-phase1-design.md`) and
implementation plan (`docs/superpowers/plans/2026-07-14-trading-bot-phase1.md`).
See `FEATURE_REGISTRY.md` for full detail.

- `BrokerAdapter` / `Strategy` / `TradeIntent` / `RiskEngine` contracts, an
  in-memory per-user `MockBroker`, a 4-rule `StubRiskEngine`, and
  `SignalEngineStrategy` (wraps the existing read-only signal engine).
- `/trading-bot` page + 4 API routes (`account`, `positions`, `orders`,
  `positions/close`), all protected, all idempotent, long-only.
- **Not included yet (deferred, see Backlog):** database persistence, the full
  risk-rule set, backtesting, extended indicators (MACD/Bollinger/multi-timeframe),
  live trading, broker credentials/connection settings, bot automation. Phase 2
  requires a separate design and explicit approval before work begins.
- **The `MockBroker`/in-memory store is a Phase 1 development aid only — it is
  NOT deployment-safe and NOT production-ready** (module-scoped state, single
  Node process only; see Caveats in `FEATURE_REGISTRY.md`). Accepted for Phase 1
  scope on that explicit basis.

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
- **AI Trading Bot Phase 4+.** Phase 4 persisted paper trading
  (`Order`/`Fill`/`Position`/`RiskProfile` Prisma models replacing the
  in-memory store) and the full risk-rule set (daily loss limit, drawdown,
  exposure caps, cooldown, circuit breakers, kill switch); Phase 5
  sandbox/testnet broker integration (requires explicit provider
  authorization); Phase 6 guarded live trading (requires a separate explicit
  authorization after Phase 4/5 review); Phase 7 security/monitoring/
  deployment hardening. Each phase requires its own brainstorming → spec →
  plan cycle before implementation, per the approved process. (Phase 2,
  extended indicators/multi-timeframe confirmation, and Phase 3, deterministic
  backtesting, are both accepted — see Completed section above.)
