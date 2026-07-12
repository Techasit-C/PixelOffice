import type { AgentInfo } from "@/types/agent";
import type { CharacterDef } from "./characters-data";
import { PixelSprite } from "./PixelSprite";
import { Desk } from "./OfficeScene";

// Deterministic look per agent: a seated worker's hair/skin are derived from a
// stable hash of the agent name (never Math.random — must be identical across
// renders and SSR/CSR), and the shirt encodes the team. This mirrors the widget:
// trading = green family, developer = purple (#a78bfa, the AI-AGENTS accent),
// other/ai-ceo = a neutral robot so the coordinator reads as distinct.
const HAIR = [
  "#2a2a2a",
  "#e07a2c",
  "#3a3a3a",
  "#221d1a",
  "#5a3a1a",
  "#6b4a2f",
  "#8a5a2a",
];
const SKIN = ["#f0c090", "#e8b98a", "#d9a066", "#f2d0b0"];
const TRADING_SHIRTS = ["#1f7a4f", "#2f6b3a", "#2f8f5b", "#3a9e6a"];

/** Stable non-negative hash of a string (djb-ish). No randomness. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function buildDef(agent: AgentInfo): CharacterDef {
  const h = hashString(agent.name);
  const isOther = agent.team === "other";

  let shirtColor: string;
  if (agent.team === "developer") shirtColor = "#a78bfa";
  else if (agent.team === "trading")
    shirtColor = TRADING_SHIRTS[(h >> 5) % TRADING_SHIRTS.length];
  else shirtColor = "#94a3b8";

  return {
    id: agent.id,
    name: agent.name,
    kind: isOther ? "robot" : "human",
    hairColor: isOther ? "#c7d2e0" : HAIR[h % HAIR.length],
    skinColor: isOther ? "#c7d2e0" : SKIN[(h >> 3) % SKIN.length],
    shirtColor,
    pantsColor: "#1f2937",
    // Unused for a static seated avatar, but required by the shared CharacterDef.
    lines: [],
    home: { x: 0, y: 0 },
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  };
}

/**
 * One roster agent, rendered as a static pixel worker seated at a desk. No state,
 * no timers, no animation. Fixed 120x150 cell so a grid of these can never overlap.
 */
export function AgentAvatar({
  agent,
  teamLabel,
}: {
  agent: AgentInfo;
  teamLabel: string;
}) {
  const def = buildDef(agent);
  const isError = agent.status === "error";
  const statusColor = isError ? "#ef4444" : "#22c55e";
  const statusGlow = isError
    ? "0 0 6px 1px rgba(239,68,68,0.7)"
    : "0 0 6px 1px rgba(34,197,94,0.55)";

  const tooltip = `${agent.name}\n${teamLabel} · ${agent.model}\n${agent.role}`;

  return (
    <div className="relative h-[150px] w-[120px]" title={tooltip}>
      {/* status dot — same colors/glow as the AI-AGENTS widget */}
      <span
        className="absolute right-2 top-1 z-20 h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: statusColor, boxShadow: statusGlow }}
      />

      {/* name chip — Character.tsx style */}
      <div className="absolute left-1/2 top-1 z-20 max-w-[100px] -translate-x-1/2 truncate rounded-sm bg-black/70 px-1 text-center text-[9px] leading-tight text-foreground/90">
        {agent.name}
      </div>

      {/* model badge — AIAgentsWidget model-chip style; render "inherit" verbatim */}
      <div className="absolute left-1/2 top-[18px] z-20 max-w-[112px] -translate-x-1/2 truncate rounded-sm bg-white/5 px-1 text-[9px] leading-tight text-muted-foreground/80">
        {agent.model}
      </div>

      {/* seated worker: head clears the monitor, body sits behind the desk */}
      <div className="absolute left-[40px] top-[34px] z-0">
        <PixelSprite def={def} frame={0} facing="right" />
      </div>
      <Desk left={28} top={60} monitors={1} />
    </div>
  );
}
