// Registry mapping an agent's canonical name to its real sprite in
// public/agents/<name>/idle_down.png (see public/agents/LICENSES.md for
// provenance — license needs confirmation). Only agents whose sprite was
// visually verified clean are listed here; everything else (a known-broken
// sprite, or any agent name the source pack never shipped at all) falls back
// to the CSS chibi avatar (OperatorAvatar) — every agent from /api/agents
// still renders either way.
//
// Cell size 64x64, RGBA, pivot at bottom-center (0.5, 0.96875) per
// agents-manifest.json — render at an integer-ish scale with
// `imageRendering: "pixelated"` to keep the pixel art crisp.
const AGENT_SPRITE_BASE = "/agents";

const GOOD_AGENT_SPRITES = new Set<string>([
  "ai-ceo",
  "cio-agent",
  "master-decision-agent",
  "macro-economist",
  "dca-portfolio-agent",
  "news-sentiment-agent",
  "solution-architect",
  "devops-engineer",
  "performance-engineer",
  "security-engineer",
  "prompt-engineer",
  "documentation-engineer",
  "project-manager",
  "qa-engineer",
  "accessibility-specialist",
  "design-system-specialist",
  "information-architect",
  "product-designer",
  "ux-researcher",
]);

// Visually confirmed broken in the source pack (a glitched shape rendered
// over/above the character) — excluded on purpose, not missing by accident.
// See public/agents/LICENSES.md for the full note.
export const BROKEN_AGENT_SPRITES = new Set<string>([
  "investment-analyst",
  "fundamental-analyst",
  "technical-analyst",
  "quant-analyst",
  "risk-manager-agent",
  "crypto-research-analyst",
  "portfolio-optimizer",
  "swing-trader",
  "ai-integration-engineer",
  "backend-developer",
  "database-engineer",
  "frontend-developer",
  "design-qa",
  "senior-graphic-designer",
  "senior-ux-ui-designer",
  "ux-ui-lead",
  "ux-writer",
]);

/** Real sprite URL for this agent name, or undefined to use the CSS fallback avatar. */
export function getAgentSpriteUrl(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  if (!GOOD_AGENT_SPRITES.has(key)) return undefined;
  return `${AGENT_SPRITE_BASE}/${key}/idle_down.png`;
}
