import type { ReactNode } from "react";
import type { AgentsResponse } from "@/types/agent";
import type { OfficeCharacterDef } from "./office-characters";

/**
 * Drawer content for a clicked office character. Looks up the character's
 * linked `agentName` in the already-fetched /api/agents roster — never a
 * duplicate fetch, never invented data. "Current task" has no real source
 * anywhere in this app (AgentInfo carries no task field), so that line is
 * always the honest "not wired" state, never fabricated.
 */
export function AgentCharacterPanel({
  character,
  agents,
  loading,
  error,
}: {
  character: OfficeCharacterDef;
  agents: AgentsResponse | null;
  loading?: boolean;
  error?: string | null;
}) {
  const matched = character.agentName
    ? (agents?.teams.flatMap((t) => t.agents).find((a) => a.name === character.agentName) ?? null)
    : null;

  if (loading && !agents) {
    return <div className="py-4 text-center text-[11px] text-muted-foreground">กำลังโหลด…</div>;
  }

  if (error && !agents) {
    return (
      <div className="text-[11px] text-danger" role="alert">
        โหลดข้อมูล agent ไม่สำเร็จ · {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium text-foreground">
          {matched?.name ?? character.name}
        </div>
        <div className="text-[11px] text-muted-foreground">{character.roleLabel}</div>
      </div>

      {matched ? (
        <div className="space-y-1.5 border-t border-border/40 pt-2 text-[11px]">
          <Row label="Status">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: matched.status === "error" ? "#ef4444" : "#22c55e",
                  boxShadow:
                    matched.status === "error"
                      ? "0 0 6px 1px rgba(239,68,68,0.7)"
                      : "0 0 6px 1px rgba(34,197,94,0.55)",
                }}
              />
              {matched.status}
            </span>
          </Row>
          <Row label="Model">{matched.model}</Row>
          <Row label="Role">
            <span className="text-muted-foreground">{matched.role || matched.summary}</span>
          </Row>
        </div>
      ) : (
        <div className="border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
          {character.agentName
            ? `No "${character.agentName}" record found in the current agent roster.`
            : "This workstation isn't linked to a specific agent record."}
        </div>
      )}

      <div className="border-t border-border/40 pt-2 text-[10px] text-muted-foreground/70">
        Current task: not wired — no live execution data available.
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="text-foreground/90">{children}</span>
    </div>
  );
}
