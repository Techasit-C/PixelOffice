import type { AgentInfo } from "@/types/agent";
import { AgentAvatar } from "./AgentAvatar";

/**
 * Renders a roster of agents as a cozy desk cluster. No absolute positioning
 * of its own — the caller (a zone card in OfficeScene) supplies the layout
 * box and, if the roster can grow past what fits, an internal scroll area.
 * Honest empty state: an empty roster renders a calm placeholder rather than
 * inventing desks.
 *
 * The grid underneath is still a strict, non-overlapping cell grid (safe at
 * any roster size) — the nth-child micro-offsets on top just break up the
 * "spreadsheet rows" look with a hand-placed feel. Offsets are a few px
 * against a 20px+ row gap, so neighboring desks never actually touch.
 */
export function TeamGrid({
  agents,
  columns = 6,
  emptyLabel = "No agents assigned to this floor",
}: {
  agents: AgentInfo[];
  columns?: number;
  emptyLabel?: string;
}) {
  if (agents.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-[11px] text-muted-foreground/50">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      className="grid items-start justify-items-center gap-x-3 gap-y-6 [&>*:nth-child(3n+1)]:-rotate-1 [&>*:nth-child(3n+2)]:translate-y-2 [&>*:nth-child(4n)]:rotate-1 [&>*:nth-child(5n)]:-translate-y-1.5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {agents.map((agent) => (
        <AgentAvatar key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
