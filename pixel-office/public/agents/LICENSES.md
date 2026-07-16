# Agent character sprite credits

Source: `pixel-office-assets-v1/people/agents/` (provided directly to this
project; not a public/downloaded asset pack).

- Character cell: 64×64 px, RGBA, nearest-neighbor pixel art.
- Frames available upstream per agent: `idle_down`, `walk_down_a`,
  `walk_down_b`, `walk_right` (see `agents-manifest.json`). This app only
  uses `idle_down` today — the walk frames stay in the source pack, unused,
  as a future path for a walk/patrol animation.
- Files here have been cleaned of a stray magenta/pink artifact baked into
  several of the upstream PNGs (a guide-line leftover from the atlas-export
  process — confirmed by direct pixel sampling: fully opaque, saturated
  magenta pixels with no relation to the character art). The fix sets those
  specific pixels to transparent; nothing else in the image was touched, and
  the original files in `pixel-office-assets-v1` were never modified.
- All 19 files were also cleaned of a green chroma-key fringe outlining every
  character silhouette (only visible on close/zoomed inspection — a
  green-screen keying leftover from the sprite-export process: fully opaque
  pixels with R and B channels near zero while G varies). Confirmed via pixel
  sampling and deliberately scoped to `public/agents/` only — office tile art
  under `public/office-assets/` was left untouched because it contains real
  plant foliage, whose green is spectrally close enough to risk false
  positives. Applied in two passes; a very faint residual remains on 2
  yellow-jacketed sprites, accepted as a reasonable tradeoff over further
  tightening the filter (which would start stripping legitimate yellow
  clothing color).

## Sprites copied (19 of 36 — `idle_down.png` only)

Every one of these was inspected directly and is visually clean:
ai-ceo, cio-agent, master-decision-agent, macro-economist,
dca-portfolio-agent, news-sentiment-agent, solution-architect,
devops-engineer, performance-engineer, security-engineer, prompt-engineer,
documentation-engineer, project-manager, qa-engineer,
accessibility-specialist, design-system-specialist, information-architect,
product-designer, ux-researcher.

## Every agent renders a real sprite — no CSS/chibi fallback in the main office

The other 17 agent names in `/api/agents` don't have a clean sprite of
their own (their upstream `idle_down.png` shows a glitched shape rendered
over the character): `investment-analyst`, `fundamental-analyst`,
`technical-analyst`, `quant-analyst`, `risk-manager-agent`,
`crypto-research-analyst`, `portfolio-optimizer`, `swing-trader`,
`ai-integration-engineer`, `backend-developer`, `database-engineer`,
`frontend-developer`, `design-qa`, `senior-graphic-designer`,
`senior-ux-ui-designer`, `ux-ui-lead`, `ux-writer`.

Rather than falling back to a different (CSS chibi) visual system for these
17, `agent-models.ts` explicitly reassigns each one to reuse one of the 19
clean sprites above, tinted with a distinct CSS `hue-rotate`/`saturate`
filter so an agent that borrows a sprite doesn't look identical to the
agent the sprite actually belongs to. See `AGENT_SPRITE` in that file for
the exact mapping. Any agent name outside this table (a future addition)
still gets a real sprite — deterministically hashed onto one of the 19 —
never a fallback to a different visual system.

## License

**License needs confirmation.** No `LICENSE` file or attribution ships with
the source pack. Do not treat these sprites as CC0 until confirmed.
