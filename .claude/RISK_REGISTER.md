# Risk Register — Pixel Office (Company-Level Governance)

Live register of known risks. Updated by the AI CEO after every approved milestone
(per `AI_COMPANY_OPERATING_SYSTEM.md`). Status values: OPEN, ACCEPTED, MITIGATED,
CLOSED. "Realized" likelihood means the condition has already occurred.

| ID | Description | Impact | Likelihood | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R-01 | In-memory cache + rate-limiter are per serverless instance (not shared) → inconsistent limits/cache under multi-instance deployment | Med | Med | Sprint 6 candidate (a): distributed store | backend-developer | OPEN (deferred) |
| R-02 | Pre-existing unauthenticated GET endpoints (`company-status`, `affiliate`, `crypto-prices`, `tradingview-webhook`) | Med | Med | Sprint 6 candidate (c): add auth | security-engineer | OPEN (deferred, pre-existing) |
| R-03 | Parent `Ai Agent/` incl. `.claude/` is not version-controlled → governance & agent `.md` unversioned | Med | High | CR-REPO-01 executed 2026-07-08 (Option B subtree merge, commit `44b3857`) — parent now version-controls `.claude/` + agents + `pixel-office/`; residual is only `.git.bak`/backup retention | devops-engineer | **CLOSED (mitigated)** |
| R-04 | Single bundled "foundation" commit `db462a6` mixes Sprint 1–4 + Sprint 5 → coarse history granularity | Low | Realized | Finer-grained commits going forward | devops-engineer | ACCEPTED |
| R-05 | Mission Control Tasks is a placeholder (no execution telemetry) → could be mistaken for real run data | Low | Low (mitigated by honest "no execution log yet" label) | Sprint 6 candidate (b): execution telemetry | ai-integration-engineer | OPEN (deferred) |
| R-06 | Commit `db462a6` is local, ahead of `origin/main` by 1, not pushed | Low | Realized | Still local/unpushed by CEO directive; unaffected by repo unification (no push performed) | devops-engineer | OPEN |
| R-07 | Pre-existing uncommitted working-tree edit in `pixel-office/package.json` (`"dev": "next dev"` vs committed `"next dev --turbopack"`); predates migration, left uncommitted for a separate dev decision | Low | Realized | Awaiting dev decision (keep or drop `--turbopack`) — NOT a migration artifact | devops-engineer | OPEN |

## Notes

- R-01, R-02, R-05 map to the three parts of the **Sprint 6 candidate** in
  `ROADMAP.md` (distributed store, auth, execution telemetry) — all **BLOCKED pending
  user approval**.
- R-03 maps to **CR-REPO-01** in `CHANGE_REQUESTS.md`.
- R-04 and R-06 are consequences of the bundled, unpushed local commit; both are
  already realized and accepted/tracked rather than open work items.
- R-03 is now CLOSED (mitigated): CR-REPO-01 executed via Option B subtree merge
  (commit `44b3857`); `.claude/`, agents, and `pixel-office/` are version-controlled.
- R-07 is a pre-existing uncommitted `package.json --turbopack` edit, not a migration
  artifact; awaits a dev decision.
