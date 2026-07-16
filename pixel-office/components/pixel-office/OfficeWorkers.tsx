import type { AgentInfo } from "@/types/agent";
import { AgentAvatar } from "./AgentAvatar";

/**
 * Renders a roster of agents as a connected row of workstations. No absolute
 * positioning of its own — the caller (a zone card in OfficeScene) supplies
 * the layout box and, if the roster grows past what fits, an internal
 * scroll area. Honest empty state: an empty roster renders a calm
 * placeholder rather than inventing desks.
 *
 * Column count is responsive (Tailwind breakpoints): 1-2 per row on a
 * narrow/mobile viewport, up to 6 on desktop, per the office's "4-6
 * workstations per row" requirement. Every cell is the same fixed size, so
 * the grid can never overlap regardless of roster length (scales cleanly
 * past 100+ agents).
 */
export function TeamGrid({
  agents,
  emptyLabel = "No agents assigned to this floor",
}: {
  agents: AgentInfo[];
  emptyLabel?: string;
}) {
  if (agents.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center text-[11px] text-muted-foreground/50">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 items-start justify-items-center gap-x-2 gap-y-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {agents.map((agent) => (
        <AgentAvatar key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
