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

// Mirror of TradingDesk's internal size math so the desk can be centered under
// the operator without exporting layout constants from that component.
const MONITOR_W = 30;
const GAP = 4;
function deskWidth(monitors: number): number {
  return monitors * MONITOR_W + (monitors - 1) * GAP;
}

/**
 * A department-tinted cubicle wall behind the whole workstation. Pure CSS,
 * low-contrast so the name/model chips layered above it stay readable — its
 * only job is to visually bind the operator + chair + desk into one "booth"
 * instead of a floating figure stacked on a floating desk.
 */
function CubicleBooth({ color, executive }: { color: string; executive?: boolean }) {
  return (
    <div
      className="absolute inset-x-1 z-0 overflow-hidden rounded-md border"
      style={{
        top: 30,
        bottom: 4,
        borderColor: `${color}33`,
        background: `linear-gradient(180deg, ${color}18 0%, rgba(28,20,12,0.55) 38%, rgba(12,8,5,0.62) 100%)`,
        boxShadow: `inset 0 0 18px ${color}12, inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}
    >
      {/* executive booths get a gold valance so the CEO desk reads as senior */}
      {executive ? (
        <span
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: `${color}88`, boxShadow: `0 0 6px ${color}` }}
        />
      ) : null}
      {/* a little wall shelf with a folder + a potted sprout for cozy density */}
      <div className="absolute right-1.5 top-2 flex items-end gap-1">
        <span className="h-1.5 w-2 rounded-[1px] bg-[#93c5fd]/50" />
        <span className="flex flex-col items-center">
          <span className="h-1.5 w-1.5 rounded-full bg-[#3a9159]" />
          <span className="h-1 w-1.5 rounded-b-[1px] bg-[#7a5a3a]" />
        </span>
      </div>
      <span
        className="absolute left-1.5 top-2 h-1.5 w-1.5 rounded-full"
        style={{ background: `${color}55`, boxShadow: `0 0 4px ${color}66` }}
      />
      {/* partition seams so neighbouring booths read as separate cubicles */}
      <span className="absolute inset-y-2 right-0 w-px bg-white/5" />
      <span className="absolute inset-y-2 left-0 w-px bg-white/5" />
    </div>
  );
}

/** A simple office chair back peeking from behind the seated operator. */
function OfficeChair({ color, errored }: { color: string; errored?: boolean }) {
  const tint = errored ? "#ef4444" : color;
  return (
    <div className="absolute bottom-[100px] left-1/2 z-[5] -translate-x-1/2">
      {/* chair back */}
      <div
        className="mx-auto h-10 w-11 rounded-t-2xl border border-black/40"
        style={{
          background: "linear-gradient(180deg, #2b2b33, #16161c)",
          boxShadow: `inset 0 0 0 2px ${tint}22`,
        }}
      />
      {/* headrest accent */}
      <span
        className="absolute left-1/2 top-1 h-1 w-6 -translate-x-1/2 rounded-full"
        style={{ background: `${tint}55` }}
      />
    </div>
  );
}

/**
 * One roster agent as a chibi AI operator SEATED at their own cubicle
 * workstation: a department-tinted booth wall, an office chair, the operator,
 * and a monitor desk drawn IN FRONT of the operator's torso so the figure and
 * the desk read as a single unit (head above the screens, desk in the
 * foreground) rather than a person floating above a separate desk.
 *
 * All motion is CSS (OperatorAvatar/TradingDesk classes) — no per-agent
 * timers. Fixed 128x210 cell so a grid of these can never overlap.
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
  const deskLeft = Math.round((128 - deskWidth(monitors)) / 2);

  const tooltip = [
    agent.name,
    agent.role || teamLabel(agent.team),
    `${teamLabel(agent.team)} · ${agent.model}`,
    `Status: ${isError ? "error" : "available"}`,
  ].join("\n");

  return (
    <div className="relative h-[210px] w-[128px]" title={tooltip}>
      {/* cubicle wall — binds the whole workstation together (behind all else) */}
      <CubicleBooth color={theme.color} executive={isCeo} />

      {/* status dot — same colors/glow as the AI-AGENTS widget */}
      <span
        className="absolute right-2 top-1 z-30 h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: statusColor, boxShadow: statusGlow }}
      />

      {/* name chip */}
      <div className="absolute left-1/2 top-1 z-30 max-w-[108px] -translate-x-1/2 truncate rounded-sm bg-black/70 px-1 text-center text-[9px] leading-tight text-foreground/90">
        {agent.name}
      </div>

      {/* model badge — render "inherit" verbatim */}
      <div className="absolute left-1/2 top-[18px] z-30 max-w-[120px] -translate-x-1/2 truncate rounded-sm bg-white/5 px-1 text-[9px] leading-tight text-muted-foreground/80">
        {agent.model}
      </div>

      {/* office chair, behind the operator */}
      <OfficeChair color={theme.color} errored={isError} />

      {/* chibi operator — seated. Its own speech-bubble slot + bouncing figure.
          Positioned so the head clears the model badge and stays visible above
          the desk monitors that overlap the torso below. */}
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

      {/* desk + monitors drawn IN FRONT of the operator (higher z), overlapping
          the torso so the operator reads as seated at this workstation. */}
      <TradingDesk
        left={deskLeft}
        top={110}
        monitors={monitors}
        accent={theme.color}
        Icon={RoleIcon}
        errored={isError}
        kind={deskKind}
        className="z-20"
      />

      {/* floor contact shadow to ground the whole booth */}
      <div className="absolute bottom-2 left-1/2 z-0 h-2 w-20 -translate-x-1/2 rounded-full bg-black/45 blur-[3px]" />
    </div>
  );
}
