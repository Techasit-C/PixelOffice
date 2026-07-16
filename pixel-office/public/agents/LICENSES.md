# Agent character sprite credits

Source: `pixel-office-assets-v1/people/agents/` (provided directly to this
project; not a public/downloaded asset pack).

- Character cell: 64×64 px, RGBA, nearest-neighbor pixel art.
- Frames available upstream per agent: `idle_down`, `walk_down_a`,
  `walk_down_b`, `walk_right` (see `agents-manifest.json`). This app only
  uses `idle_down` today — the walk frames stay in the source pack, unused,
  as a future path for a walk/patrol animation.

## Agents copied (19 of 36 — `idle_down.png` only)

ai-ceo, cio-agent, master-decision-agent, macro-economist,
dca-portfolio-agent, news-sentiment-agent, solution-architect,
devops-engineer, performance-engineer, security-engineer, prompt-engineer,
documentation-engineer, project-manager, qa-engineer,
accessibility-specialist, design-system-specialist, information-architect,
product-designer, ux-researcher.

## Agents skipped — rendering defects, not copied

The following 17 sprites were inspected directly and show a clear visual
defect (a glitched dark/colored shape rendered above or over the character,
inconsistent with the clean business-casual art style of the rest of the
pack): `investment-analyst`, `fundamental-analyst`, `technical-analyst`,
`quant-analyst`, `risk-manager-agent`, `crypto-research-analyst`,
`portfolio-optimizer`, `swing-trader`, `ai-integration-engineer`,
`backend-developer`, `database-engineer`, `frontend-developer`, `design-qa`,
`senior-graphic-designer`, `senior-ux-ui-designer`, `ux-ui-lead`,
`ux-writer`.

These agents still render in the app — they fall back to the existing
CSS chibi avatar (`OperatorAvatar`), not a broken image. If the source pack
is regenerated/fixed, re-copy the corrected `idle_down.png` into
`public/agents/<name>/` and add the name to `agent-models.ts`.

## License

**License needs confirmation.** Same provenance note as
`public/office-assets/LICENSES.md`: no `LICENSE` file or attribution ships
with the source pack. Do not treat these sprites as CC0 until confirmed.
