// Explicit agent → sprite mapping for the main office. Every agent renders
// a real asset sprite here — there is no CSS/chibi fallback path in the main
// office (see AgentAvatar.tsx). Only 19 of the 36 known agent names have a
// visually clean sprite in the source pack (see public/agents/LICENSES.md
// for the other 17, which show a confirmed rendering defect); those 17 are
// explicitly reassigned to reuse one of the 19 clean sprites below, each
// tinted with a distinct CSS filter variant so two agents sharing a sprite
// still read as different people. Any agent name outside this table (a
// future addition) still gets a real sprite — deterministically hashed onto
// one of the 19 clean sprites with a hashed variant — never a fallback to
// the old CSS chibi model.
const SPRITE_BASE = "/agents";

/** The 19 sprites visually confirmed clean (no rendering defect). */
const CLEAN_SPRITES = [
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
] as const;

type CleanSprite = (typeof CLEAN_SPRITES)[number];

/**
 * Explicit agent name -> [sprite, variant] mapping. variant 0 = the sprite's
 * own natural colors (used by the agent the sprite actually belongs to);
 * variant 1-5 = a hue-shifted tint (see VARIANT_FILTERS) for every agent
 * that had to borrow someone else's clean sprite.
 */
const AGENT_SPRITE: Record<string, [CleanSprite, number]> = {
  // Agents with their own clean sprite — natural colors.
  "ai-ceo": ["ai-ceo", 0],
  "cio-agent": ["cio-agent", 0],
  "master-decision-agent": ["master-decision-agent", 0],
  "macro-economist": ["macro-economist", 0],
  "dca-portfolio-agent": ["dca-portfolio-agent", 0],
  "news-sentiment-agent": ["news-sentiment-agent", 0],
  "solution-architect": ["solution-architect", 0],
  "devops-engineer": ["devops-engineer", 0],
  "performance-engineer": ["performance-engineer", 0],
  "security-engineer": ["security-engineer", 0],
  "prompt-engineer": ["prompt-engineer", 0],
  "documentation-engineer": ["documentation-engineer", 0],
  "project-manager": ["project-manager", 0],
  "qa-engineer": ["qa-engineer", 0],
  "accessibility-specialist": ["accessibility-specialist", 0],
  "design-system-specialist": ["design-system-specialist", 0],
  "information-architect": ["information-architect", 0],
  "product-designer": ["product-designer", 0],
  "ux-researcher": ["ux-researcher", 0],

  // Agents whose own sprite is defective — reassigned to a clean sprite,
  // tinted so they don't look identical to the sprite's natural owner.
  "fundamental-analyst": ["macro-economist", 1],
  "technical-analyst": ["cio-agent", 2],
  "crypto-research-analyst": ["dca-portfolio-agent", 3],
  "quant-analyst": ["master-decision-agent", 4],
  "swing-trader": ["news-sentiment-agent", 5],
  "risk-manager-agent": ["security-engineer", 1],
  "portfolio-optimizer": ["project-manager", 2],
  "investment-analyst": ["qa-engineer", 3],
  "frontend-developer": ["product-designer", 4],
  "backend-developer": ["devops-engineer", 5],
  "database-engineer": ["performance-engineer", 1],
  "ai-integration-engineer": ["prompt-engineer", 2],
  "design-qa": ["accessibility-specialist", 3],
  "senior-graphic-designer": ["information-architect", 4],
  "senior-ux-ui-designer": ["design-system-specialist", 5],
  "ux-ui-lead": ["ux-researcher", 1],
  "ux-writer": ["documentation-engineer", 2],
};

// CSS `filter` per variant index — 0 is "no filter" (the sprite's own
// colors). Kept deliberately gentle: a full hue-rotate on the whole sprite
// shifts skin tone along with clothing, and anything past ~25deg pushes
// skin into visibly unnatural green/blue/purple territory. These stay in a
// "different tie/shirt shade" range instead.
const VARIANT_FILTERS = [
  "none",
  "hue-rotate(14deg) saturate(1.08)",
  "hue-rotate(-14deg) saturate(1.05)",
  "hue-rotate(22deg) saturate(0.95) brightness(1.04)",
  "hue-rotate(-22deg) saturate(1.1)",
  "hue-rotate(9deg) saturate(0.92) brightness(0.97)",
];

/**
 * Per-sprite display-scale compensation. The source pack isn't consistent —
 * most character art fills ~58px of the 64px canvas (bottom-anchored), but
 * three sprites (ai-ceo, solution-architect, accessibility-specialist) were
 * exported noticeably smaller within the same canvas. Left uncompensated,
 * those three agents would look tiny next to everyone else at the same
 * container size — measured directly via pixel bounding boxes, not guessed.
 * Applied as a CSS transform with a bottom-center origin, so it grows the
 * character upward from their (fixed) feet position rather than shifting
 * them off their desk.
 */
const SPRITE_SCALE: Partial<Record<CleanSprite, number>> = {
  "ai-ceo": 1.5,
  "solution-architect": 1.45,
  "accessibility-specialist": 1.5,
};

/** Stable non-negative hash of a string. Never randomness — must match on SSR/CSR. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function resolve(name: string): [CleanSprite, number] {
  const key = name.trim().toLowerCase();
  const known = AGENT_SPRITE[key];
  if (known) return known;
  // Unknown agent (future addition) — still a real sprite, deterministically
  // hashed, never the CSS chibi fallback.
  const h = hashString(key);
  const sprite = CLEAN_SPRITES[h % CLEAN_SPRITES.length];
  const variant = (h >> 4) % VARIANT_FILTERS.length;
  return [sprite, variant];
}

/** Real sprite URL for this agent name — every agent gets one, always. */
export function getAgentSpriteUrl(name: string): string {
  const [sprite] = resolve(name);
  return `${SPRITE_BASE}/${sprite}/idle_down.png`;
}

/** CSS filter to apply to the sprite (tints reused/"borrowed" sprites). */
export function getAgentSpriteFilter(name: string): string {
  const [, variant] = resolve(name);
  return VARIANT_FILTERS[variant];
}

/** Extra CSS transform (scale, bottom-anchored) to normalize apparent size. */
export function getAgentSpriteScale(name: string): number {
  const [sprite] = resolve(name);
  return SPRITE_SCALE[sprite] ?? 1;
}
