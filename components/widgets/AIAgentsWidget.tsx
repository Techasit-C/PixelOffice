import type { AgentInfo, AgentsResponse } from "@/types/agent";

/** File mtime → short "last edited" label. Falls back to raw string if unparseable. */
function formatEdited(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} ชม.ที่แล้ว`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} วันก่อน`;
  return new Date(then).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
  });
}

function AgentRow({ agent }: { agent: AgentInfo }) {
  const isError = agent.status === "error";
  const toolCount = agent.tools.length;
  const firstTools = agent.tools.slice(0, 2).join(", ");
  const extra = toolCount > 2 ? ` +${toolCount - 2}` : "";

  return (
    <div className="flex items-start gap-2 rounded-sm px-1 py-1 hover:bg-white/5">
      <span
        className="mt-1 h-2 w-2 shrink-0 rounded-full"
        title={
          isError
            ? `error — ${agent.error ?? "invalid agent file"}`
            : "installed — not currently running"
        }
        style={{
          backgroundColor: isError ? "#ef4444" : "#22c55e",
          boxShadow: isError
            ? "0 0 6px 1px rgba(239,68,68,0.7)"
            : "0 0 6px 1px rgba(34,197,94,0.55)",
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{agent.name}</span>
          <span className="shrink-0 rounded-sm bg-white/5 px-1 text-[9px] leading-tight text-muted-foreground/80">
            {agent.model}
          </span>
          {agent.overridesUser ? (
            <span
              className="shrink-0 rounded-sm bg-amber-500/15 px-1 text-[9px] leading-tight text-amber-400"
              title="project agent overrides a user agent of the same name"
            >
              override
            </span>
          ) : null}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">
          {isError && agent.error ? agent.error : agent.summary || agent.role}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[9px] text-muted-foreground/70">
          <span className="truncate">
            {toolCount > 0 ? `🛠 ${firstTools}${extra}` : "no tools"}
          </span>
          <span
            className="shrink-0"
            title="แก้ไขไฟล์ล่าสุด / last edited"
          >
            {formatEdited(agent.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AIAgentsWidget({
  data,
  loading,
  error,
}: {
  data: AgentsResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !data) {
    return (
      <div className="py-6 text-center text-[10px] text-muted-foreground">
        กำลังโหลด agents…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6 text-center text-[10px] text-danger">
        โหลด agents ไม่สำเร็จ
        <div className="mt-1 text-muted-foreground/70">{error}</div>
      </div>
    );
  }

  if (!data || data.source === "empty" || data.teams.length === 0) {
    return (
      <div className="py-6 text-center text-[10px] text-muted-foreground">
        ไม่พบไฟล์ agent บนเครื่องนี้
        <div className="mt-1 text-muted-foreground/60">
          no agent files found on this host
        </div>
      </div>
    );
  }

  const total = data.teams.reduce((n, g) => n + g.agents.length, 0);

  return (
    <div>
      <div className="max-h-72 overflow-y-auto scrollbar-thin pr-0.5">
        {data.teams.map((group) => (
          <div key={group.team} className="mb-2 last:mb-0">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-[#0b0e1a] py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              <span>{group.label}</span>
              <span className="text-muted-foreground/50">
                {group.agents.length}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              {group.agents.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 text-[9px] text-muted-foreground/70">
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "#22c55e" }}
            />
            installed/valid
          </span>
          <span className="flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "#ef4444" }}
            />
            error
          </span>
        </span>
        <span>{total} agents · ไม่ได้กำลังรัน</span>
      </div>
    </div>
  );
}
