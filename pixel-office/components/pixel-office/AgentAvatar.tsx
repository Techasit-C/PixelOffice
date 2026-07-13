import type { AgentInfo } from "@/types/agent";
import type { CharacterDef } from "./characters-data";
import { PixelSprite } from "./PixelSprite";
import { TradingDesk } from "./TradingDesk";
import { DEPARTMENT_THEME, type Department } from "./department-theme";
import { getMonitorCount, getRoleIcon } from "./role-visuals";
import { teamLabel } from "@/lib/agents/teams";

// Deterministic look per agent: a seated worker's hair/skin are derived from a
// stable hash of the agent name (never Math.random — must be identical across
// renders and SSR/CSR), and the shirt encodes the department.
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

/** Stable non-negative hash of a string (djb-ish). No randomness. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function departmentOf(agent: AgentInfo): Department {
  if (agent.team === "trading") return "trading";
  if (agent.team === "developer") return "developer";
  return "executive";
}

function buildDef(agent: AgentInfo, deptColor: string): CharacterDef {
  const h = hashString(agent.name);
  const isCeo = agent.name.trim().toLowerCase() === "ai-ceo";

  return {
    id: agent.id,
    name: agent.name,
    kind: isCeo ? "robot" : "human",
    hairColor: isCeo ? "#f2e6c9" : HAIR[h % HAIR.length],
    skinColor: isCeo ? deptColor : SKIN[(h >> 3) % SKIN.length],
    shirtColor: deptColor,
    pantsColor: "#1f2937",
    // Unused for a static seated avatar, but required by the shared CharacterDef.
    lines: [],
    home: { x: 0, y: 0 },
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  };
}

/**
 * One roster agent, rendered as a static pixel worker seated at a Bloomberg-
 * style desk. No state, no timers, no animation loop. Fixed cell so a grid of
 * these can never overlap.
 */
export function AgentAvatar({ agent }: { agent: AgentInfo }) {
  const dept = departmentOf(agent);
  const theme = DEPARTMENT_THEME[dept];
  const def = buildDef(agent, theme.color);
  const isError = agent.status === "error";
  const statusColor = isError ? "#ef4444" : "#22c55e";
  const statusGlow = isError
    ? "0 0 6px 1px rgba(239,68,68,0.7)"
    : "0 0 6px 1px rgba(34,197,94,0.55)";
  const RoleIcon = getRoleIcon(agent.name);
  const monitors = getMonitorCount(agent.name);

  const tooltip = [
    agent.name,
    agent.role || teamLabel(agent.team),
    `${teamLabel(agent.team)} · ${agent.model}`,
    `Status: ${isError ? "error" : "available"}`,
  ].join("\n");

  return (
    <div className="relative h-[168px] w-[128px]" title={tooltip}>
      {/* status dot — same colors/glow as the AI-AGENTS widget */}
      <span
        className="absolute right-2 top-1 z-20 h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: statusColor, boxShadow: statusGlow }}
      />

      {/* name chip */}
      <div className="absolute left-1/2 top-1 z-20 max-w-[108px] -translate-x-1/2 truncate rounded-sm bg-black/70 px-1 text-center text-[9px] leading-tight text-foreground/90">
        {agent.name}
      </div>

      {/* model badge — render "inherit" verbatim */}
      <div className="absolute left-1/2 top-[18px] z-20 max-w-[120px] -translate-x-1/2 truncate rounded-sm bg-white/5 px-1 text-[9px] leading-tight text-muted-foreground/80">
        {agent.model}
      </div>

      {/* seated worker: head clears the monitor, body sits behind the desk */}
      <div className="absolute left-[44px] top-[36px] z-0">
        <PixelSprite def={def} frame={0} facing="right" />
      </div>
      <TradingDesk
        left={20}
        top={62}
        monitors={monitors}
        accent={theme.color}
        Icon={RoleIcon}
        errored={isError}
      />
    </div>
  );
}
