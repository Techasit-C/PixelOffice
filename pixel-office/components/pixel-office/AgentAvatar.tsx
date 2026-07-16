import type { AgentInfo } from "@/types/agent";
import { TradingDesk } from "./TradingDesk";
import { OfficeAsset } from "./OfficeAsset";
import { getAgentSpriteFilter, getAgentSpriteScale, getAgentSpriteUrl } from "./agent-models";
import { DEPARTMENT_THEME, type Department } from "./department-theme";
import { getDeskKind, getMonitorCount, getRoleIcon } from "./role-visuals";
import { teamLabel } from "@/lib/agents/teams";

function departmentOf(agent: AgentInfo): Department {
  if (agent.team === "trading") return "trading";
  if (agent.team === "developer") return "developer";
  return "executive";
}

const CHAR_BOX = 96; // container the sprite is fit into (object-fit: contain)
const DESK_SIZE = 100; // ~1.4-1.8x the sprite's own apparent width

/**
 * One roster agent, standing at their own workstation: name label above,
 * character sprite at the desk, monitor(s) drawn in front so the character
 * reads as seated/standing there rather than floating. Every agent renders
 * a real asset sprite (agent-models.ts) — there is no CSS/chibi fallback in
 * the main office. All motion is CSS — no per-agent timers. Fixed cell so a
 * grid of these can never overlap.
 */
export function AgentAvatar({ agent }: { agent: AgentInfo }) {
  const dept = departmentOf(agent);
  const theme = DEPARTMENT_THEME[dept];
  const isError = agent.status === "error";
  const statusColor = isError ? "#ef4444" : "#22c55e";
  const RoleIcon = getRoleIcon(agent.name);
  const monitors = getMonitorCount(agent.name);
  const deskKind = getDeskKind(agent.name);
  const spriteUrl = getAgentSpriteUrl(agent.name);
  const spriteFilter = getAgentSpriteFilter(agent.name);
  const spriteScale = getAgentSpriteScale(agent.name);
  const deskLeft = Math.round((CHAR_BOX - DESK_SIZE) / 2);

  const tooltip = [
    agent.name,
    agent.role || teamLabel(agent.team),
    `${teamLabel(agent.team)} · ${agent.model}`,
    `Status: ${isError ? "error" : "available"}`,
  ].join("\n");

  return (
    <div className="relative flex w-[120px] flex-col items-center" title={tooltip}>
      {/* name + status — small dot instead of a glowing box; tooltip carries
          the full detail, so the visible chrome here stays minimal. */}
      <div className="flex max-w-full items-center gap-1 px-1">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            backgroundColor: statusColor,
            boxShadow: isError ? "0 0 4px rgba(239,68,68,0.7)" : "0 0 4px rgba(34,197,94,0.6)",
          }}
        />
        <span className="truncate text-[9px] leading-tight text-foreground/90">{agent.name}</span>
      </div>
      <div className="max-w-full truncate px-1 text-[8px] leading-tight text-muted-foreground/70">
        {agent.model}
      </div>

      {/* character + desk — a single grounded unit, no surrounding box */}
      <div className="relative mt-0.5" style={{ width: CHAR_BOX, height: CHAR_BOX + DESK_SIZE - 22 }}>
        <div className="animate-idle-bounce absolute inset-x-0 top-0" style={{ height: CHAR_BOX }}>
          <OfficeAsset
            src={spriteUrl}
            alt={`${agent.name} sprite`}
            width={CHAR_BOX}
            height={CHAR_BOX}
            scale={spriteScale}
            filter={spriteFilter}
            className={isError ? undefined : "animate-type-hand"}
          />
          {/* role badge — sprites are generic business-casual, so this still
              carries "which specialty" at a glance. */}
          <div
            className="absolute right-1 top-2 flex h-4 w-4 items-center justify-center rounded-full border"
            style={{
              borderColor: `${theme.color}88`,
              background: `${theme.color}22`,
            }}
          >
            <RoleIcon className="h-2.5 w-2.5" style={{ color: theme.color }} strokeWidth={2.5} />
          </div>
        </div>

        {/* desk + monitor(s), drawn in front of (overlapping) the character's
            lower body so the agent reads as grounded at this workstation. */}
        <TradingDesk
          left={deskLeft}
          top={CHAR_BOX - 22}
          monitors={monitors}
          accent={theme.color}
          Icon={RoleIcon}
          errored={isError}
          kind={deskKind}
          size={DESK_SIZE}
          className="z-10"
        />

        {/* floor contact shadow to ground the whole workstation */}
        <div
          className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black/40 blur-[2px]"
          style={{ top: CHAR_BOX + DESK_SIZE - 26, width: DESK_SIZE * 0.8, height: 6 }}
        />
      </div>
    </div>
  );
}
