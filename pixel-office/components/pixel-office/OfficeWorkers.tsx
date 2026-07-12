import type { AgentsResponse, AgentTeam } from "@/types/agent";
import { AgentAvatar } from "./AgentAvatar";

// One absolutely-positioned zone per team, anchored in the free center band of the
// scene — clear of the far-left (x~20) and far-right (x~1360) widget columns. A
// FIXED-CELL grid (AgentAvatar is 120x150) guarantees no avatar ever overlaps
// another, regardless of team size, and the zones are stacked so they never
// overlap each other.
const ZONES: Record<AgentTeam, { left: number; top: number; grid: string }> = {
  trading: { left: 360, top: 280, grid: "grid grid-cols-7" },
  developer: { left: 360, top: 680, grid: "grid grid-cols-6" },
  other: { left: 360, top: 1080, grid: "flex flex-wrap" },
};

/**
 * Renders the FULL agent roster from the shared /api/agents payload as seated
 * pixel workers, grouped by team. Honest empty state: no data (or an empty host)
 * renders nothing rather than inventing avatars.
 */
export function OfficeWorkers({ agents }: { agents: AgentsResponse | null }) {
  if (!agents || agents.source === "empty") return null;

  return (
    <>
      {agents.teams.map((group) => {
        const zone = ZONES[group.team];
        return (
          <div
            key={group.team}
            className="absolute"
            style={{ left: zone.left, top: zone.top }}
          >
            <div
              className="mb-2 font-pixel text-sm uppercase tracking-wide text-[#f2e6c9]"
              style={{ textShadow: "0 0 6px rgba(0,0,0,0.7)" }}
            >
              {group.label}
            </div>
            <div className={`${zone.grid} gap-x-4 gap-y-6`}>
              {group.agents.map((agent) => (
                <AgentAvatar
                  key={agent.id}
                  agent={agent}
                  teamLabel={group.label}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
