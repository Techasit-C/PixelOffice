import type { AgentInfo } from "@/types/agent";
import { OperatorAvatar } from "./OperatorAvatar";
import { TradingDesk } from "./TradingDesk";
import { OfficeAsset } from "./OfficeAsset";
import { getAgentSpriteUrl } from "./agent-models";
import { DEPARTMENT_THEME, type Department } from "./department-theme";
import { getCatchphrase, getDeskKind, getMonitorCount, getRoleIcon } from "./role-visuals";
import { teamLabel } from "@/lib/agents/teams";

function departmentOf(agent: AgentInfo): Department {
  if (agent.team === "trading") return "trading";
  if (agent.team === "developer") return "developer";
  return "executive";
}

const CHAR_SIZE = 108; // rendered size; native sprite art is 64x64

/**
 * A department-tinted cubicle wall behind the whole workstation. Pure CSS,
 * low-contrast so the name/model chips and the real asset art layered above
 * it stay readable — its only job is to bind the operator + desk into one
 * "booth" and carry the team color, since neither the character sprite nor
 * the desk tile art is department-colored on its own.
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
      {executive ? (
        <span
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: `${color}88`, boxShadow: `0 0 6px ${color}` }}
        />
      ) : null}
      <span className="absolute inset-y-2 right-0 w-px bg-white/5" />
      <span className="absolute inset-y-2 left-0 w-px bg-white/5" />
    </div>
  );
}

/**
 * One roster agent, standing at their own workstation. When a clean sprite
 * exists (agent-models.ts) it's rendered as the real pixel-art character;
 * otherwise this falls back to the CSS chibi OperatorAvatar so every agent
 * from /api/agents still renders something. All motion is CSS — no
 * per-agent timers. Fixed 128x214 cell so a grid of these can never overlap.
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
  const spriteUrl = getAgentSpriteUrl(agent.name);

  const tooltip = [
    agent.name,
    agent.role || teamLabel(agent.team),
    `${teamLabel(agent.team)} · ${agent.model}`,
    `Status: ${isError ? "error" : "available"}`,
  ].join("\n");

  return (
    <div className="relative h-[214px] w-[128px]" title={tooltip}>
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

      {/* character — real sprite when available, chibi CSS fallback otherwise.
          A soft department/status glow sits behind it since the sprite art
          itself can't be recolored without wrecking the pixel art. */}
      <div className="absolute left-1/2 top-7 z-10 -translate-x-1/2">
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full blur-md"
          style={{ background: `${statusColor}33` }}
        />
        {spriteUrl ? (
          <div className="animate-idle-bounce">
            <OfficeAsset
              src={spriteUrl}
              alt={`${agent.name} sprite`}
              width={CHAR_SIZE}
              height={CHAR_SIZE}
              fallback={
                <OperatorAvatar
                  name={agent.name}
                  accent={theme.color}
                  errored={isError}
                  executive={isCeo}
                  AccessoryIcon={RoleIcon}
                  catchphrase={catchphrase}
                />
              }
            />
          </div>
        ) : (
          <OperatorAvatar
            name={agent.name}
            accent={theme.color}
            errored={isError}
            executive={isCeo}
            AccessoryIcon={RoleIcon}
            catchphrase={catchphrase}
          />
        )}
        {/* role badge — only for the real-sprite path; OperatorAvatar already
            renders its own accessory badge, so skip this for the CSS fallback
            to avoid showing two badges on one character. The sprite art is
            generic business-casual, so this still carries "which specialty"
            at a glance. */}
        {spriteUrl ? (
          <div
            className="absolute -right-1 top-0 z-20 flex h-5 w-5 items-center justify-center rounded-full border"
            style={{
              borderColor: `${theme.color}99`,
              background: `${theme.color}26`,
              boxShadow: `0 0 5px ${theme.color}88`,
            }}
          >
            <RoleIcon className="h-3 w-3" style={{ color: theme.color }} strokeWidth={2.5} />
          </div>
        ) : null}
      </div>

      {/* desk + monitor(s), drawn in front of (below/overlapping) the
          character so the agent reads as standing at this workstation. */}
      <TradingDesk
        left={16}
        top={118}
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
