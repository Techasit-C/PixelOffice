# Change Requests — Pixel Office (Company-Level Governance)

Log of proposed changes to architecture, governance, or scope. Each CR records
Reason / Impact / Risks / Affected Components / Priority / Status / Approval, per the
Change Request Policy in `AI_COMPANY_OPERATING_SYSTEM.md`. **No architecture or scope
change is executed without approval.**

| ID | Title | Priority | Status | Approval |
|---|---|---|---|---|
| CR-GOV-01 | Canonicalize governance docs location to `.claude/` | Medium | OPEN | PENDING |
| CR-REPO-01 | Version-control scope for the parent `Ai Agent/` folder | Medium | **DONE / CLOSED** | **APPROVED-EXECUTED** |

---

## CR-GOV-01 — Canonicalize governance docs location to `.claude/`

- **Status:** OPEN
- **Approval:** PENDING
- **Priority:** Medium
- **Reason:** Governance docs were first written under `pixel-office/`, but the CEO
  directive and the AIOS priority list (`AI_COMPANY_OPERATING_SYSTEM.md`) read them
  from `.claude/`. This CR makes `.claude/` the canonical company-level location.
- **Impact:** Two-tier docs now exist — company-level in `.claude/` and app-level in
  `pixel-office/`. They risk drifting out of sync unless one-line cross-reference notes
  and an update discipline are maintained (each `.claude/` doc now points to its
  app-scoped copy).
- **Risks:** Divergence between the two tiers; readers acting on a stale copy.
- **Affected components:** All governance `.md` — `PROJECT_STATUS.md`, `ROADMAP.md`,
  `RELEASE_NOTES.md`, `CHANGE_REQUESTS.md`, `RISK_REGISTER.md` (and any future
  `FEATURE_REGISTRY.md` / registries) in both `.claude/` and `pixel-office/`.
- **Note (2026-07-08):** Governance is now genuinely version-controlled. CR-REPO-01
  unified the repo at `Ai Agent/`, so this doc's canonical `.claude/` location is now
  tracked by git. The remaining OPEN work is only the two-tier sync discipline, not
  the versioning gap.

## CR-REPO-01 — Version-control scope for the parent `Ai Agent/` folder

- **Status:** DONE / CLOSED (executed 2026-07-08)
- **Approval:** APPROVED-EXECUTED
- **Resolution (2026-07-08):** Unified repo at `Ai Agent/` via Option B (built-in git
  subtree merge). `pixel-office` history merged under the `pixel-office/` subpath;
  merge commit **`44b3857`** (two parents `e9f5084` + `db462a6`). `.claude/`
  (governance + agents) is now tracked. Nested `pixel-office/.git` retired to
  `pixel-office/.git.bak` as a full-history archive. **No files deleted, no push,
  no deploy.** See PROJECT_STATUS.md "Repository" for details and follow-up notes.
