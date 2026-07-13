import type { AgentInfo } from "@/types/agent";
import { AgentAvatar } from "./AgentAvatar";

/**
 * Renders a roster of agents as seated pixel workers in a responsive grid.
 * No absolute positioning of its own — the caller (a floor panel in
 * OfficeScene) supplies the layout box and, if the roster can grow past what
 * fits, an internal scroll area. Honest empty state: an empty roster renders
 * a calm placeholder rather than inventing desks.
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
      className="grid items-start justify-items-center gap-x-2 gap-y-4"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {agents.map((agent) => (
        <AgentAvatar key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
