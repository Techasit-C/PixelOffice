import type { AgentInfo } from "@/types/agent";
import { OperatorAvatar } from "./OperatorAvatar";
import { TradingDesk } from "./TradingDesk";
import { DEPARTMENT_THEME, type Department } from "./department-theme";
import { getCatchphrase, getDeskKind, getMonitorCount, getRoleIcon } from "./role-visuals";
import { teamLabel } from "@/lib/agents/teams";

function departmentOf(agent: AgentInfo): Department {
  if (agent.team === "trading") return "trading";
  if (agent.team === "developer") return "developer";
  return "executive";
}

/**
 * One roster agent, rendered as a chibi AI operator seated at a cozy desk. No
 * per-agent timers — all motion is CSS, driven by the classes on
 * OperatorAvatar/TradingDesk. Fixed cell so a grid of these can never
 * overlap.
 */
export function AgentAvatar({ agent }: { agent: AgentInfo }) {
  const dept = departmentOf(agent);
  const theme = DEPARTMENT_THEME[dept];
  const isError = agent.status === "error";
  const isCeo = agent.name.trim().toLowerCase() === "ai-ceo";
  const statusColor = isError ? "#ef4444" : "#22c55e";
  const statusGlow = isError
    ? "0 0 6px 1px rgba(239,68,68,0.7)"
    : "0 0 6px 1px rgba(34,197,94,0.55)";
  const RoleIcon = getRoleIcon(agent.name);
  const monitors = getMonitorCount(agent.name);
  const deskKind = getDeskKind(agent.name);
  const catchphrase = getCatchphrase(agent.name);

  const tooltip = [
    agent.name,
    agent.role || teamLabel(agent.team),
    `${teamLabel(agent.team)} · ${agent.model}`,
    `Status: ${isError ? "error" : "available"}`,
  ].join("\n");

  return (
    <div className="relative h-[214px] w-[128px]" title={tooltip}>
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

      {/* chibi operator — its own speech-bubble slot + bouncing figure. Starts
          well below the model badge so the periodic speech bubble never
          collides with it. */}
      <div className="absolute left-1/2 top-8 z-10 -translate-x-1/2">
        <OperatorAvatar
          name={agent.name}
          accent={theme.color}
          errored={isError}
          executive={isCeo}
          AccessoryIcon={RoleIcon}
          catchphrase={catchphrase}
        />
      </div>

      <TradingDesk
        left={20}
        top={128}
        monitors={monitors}
        accent={theme.color}
        Icon={RoleIcon}
        errored={isError}
        kind={deskKind}
      />
    </div>
  );
}
