import { Plus } from "lucide-react";
import type { Agent } from "@/types/agent";

export function AIAgentsWidget({ agents }: { agents: Agent[] }) {
  return (
    <div>
      <div className="flex flex-col gap-1.5">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-white/5"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  agent.status === "active" ? "#22c55e" : "#64748b",
                boxShadow:
                  agent.status === "active"
                    ? "0 0 6px 1px rgba(34,197,94,0.7)"
                    : undefined,
              }}
            />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{agent.name}</div>
              <div className="truncate text-[10px] text-muted-foreground">
                {agent.latestAnalysis}
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-sm border border-dashed border-border/60 py-1 text-[10px] text-muted-foreground hover:border-border hover:text-foreground"
      >
        <Plus className="h-3 w-3" /> เพิ่ม agent
      </button>
    </div>
  );
}
