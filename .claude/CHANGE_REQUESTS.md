# Change Requests — Pixel Office (Company-Level Governance)

Log of proposed changes to architecture, governance, or scope. Each CR records
Reason / Impact / Risks / Affected Components / Priority / Status / Approval, per the
Change Request Policy in `AI_COMPANY_OPERATING_SYSTEM.md`. **No architecture or scope
change is executed without approval.**

| ID | Title | Priority | Status | Approval |
|---|---|---|---|---|
| CR-GOV-01 | Canonicalize governance docs location to `.claude/` | Medium | OPEN | PENDING |
| CR-REPO-01 | Version-control scope for the parent `Ai Agent/` folder | Medium | OPEN | PENDING |

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

## CR-REPO-01 — Version-control scope for the parent `Ai Agent/` folder

- **Status:** OPEN — needs user decision (devops can execute once decided)
- **Approval:** PENDING
- **Priority:** Medium
- **Reason:** Only `pixel-office/` is a git repository. The parent `Ai Agent/` folder
  — including this `.claude/` governance directory, all agent definitions in
  `.claude/agents/`, and `portfolio_stress_test/` — is **not tracked by git**, so
  governance docs and agent prompts are currently **unversioned**.
- **Impact:** No history, diff, or rollback for governance documents or agent system
  prompts; accidental edits/deletions are unrecoverable.
- **Risks:** Loss of governance/agent history; no audit trail for prompt changes;
  inability to revert a bad edit.
- **Affected components:** `.claude/` (governance + `agents/`), `portfolio_stress_test/`,
  and the parent `Ai Agent/` root.
- **Options:**
  - **(i)** `git init` a repository at `Ai Agent/` (parent), tracking `.claude/` and
    `portfolio_stress_test/` while keeping the existing `pixel-office/` repo (nested or
    as a submodule — devops to determine).
  - **(ii)** Keep governance intentionally local/unversioned (accept the risk
    explicitly).
