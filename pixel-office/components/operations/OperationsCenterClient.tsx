"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { PixelCard, StatLine } from "@/components/ui/PixelCard";
import { useJsonPoll } from "@/lib/use-json-poll";
import type { AgentInfo, AgentsResponse } from "@/types/agent";

const ACCENT = "#a78bfa";

/** File mtime → short "last edited" label (mirrors AIAgentsWidget). */
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

function StatusDot({ agent }: { agent: AgentInfo }) {
  const isError = agent.status === "error";
  return (
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
  );
}

/** Full-width roster row — expanded from AIAgentsWidget's compact AgentRow. */
function AgentCard({ agent }: { agent: AgentInfo }) {
  const isError = agent.status === "error";
  const toolCount = agent.tools.length;
  return (
    <div className="flex items-start gap-2.5 rounded-sm border border-border/40 bg-white/[0.02] px-2.5 py-2 hover:bg-white/5">
      <StatusDot agent={agent} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-medium">{agent.name}</span>
          <span className="shrink-0 rounded-sm bg-white/5 px-1 text-[9px] leading-tight text-muted-foreground/80">
            {agent.model}
          </span>
          <span
            className="shrink-0 rounded-sm bg-white/5 px-1 text-[9px] leading-tight text-muted-foreground/80"
            title={`scope: ${agent.scope}`}
          >
            {agent.scope}
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
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {isError && agent.error ? agent.error : agent.summary || agent.role}
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground/70">
          <span className="min-w-0 truncate">
            {toolCount > 0 ? `🛠 ${agent.tools.join(", ")}` : "no tools"}
          </span>
          <span className="shrink-0" title="แก้ไขไฟล์ล่าสุด / last edited">
            แก้ไขไฟล์ล่าสุด {formatEdited(agent.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function OperationsCenterClient() {
  const agents = useJsonPoll<AgentsResponse>("/api/agents", 30_000);
  const [query, setQuery] = useState("");

  const all = useMemo(
    () => (agents.data?.teams ?? []).flatMap((t) => t.agents),
    [agents.data],
  );

  const summary = useMemo(() => {
    const errors = all.filter((a) => a.status === "error");
    const project = all.filter((a) => a.scope === "project").length;
    const user = all.filter((a) => a.scope === "user").length;
    const overrides = all.filter((a) => a.overridesUser).length;
    return {
      total: all.length,
      available: all.length - errors.length,
      errors,
      project,
      user,
      overrides,
      perTeam: (agents.data?.teams ?? []).map((t) => ({
        label: t.label,
        count: t.agents.length,
      })),
    };
  }, [all, agents.data]);

  const recentlyEdited = useMemo(
    () =>
      [...all]
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        .slice(0, 8),
    [all],
  );

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    const teams = agents.data?.teams ?? [];
    if (!q) return teams;
    return teams
      .map((t) => ({
        ...t,
        agents: t.agents.filter((a) =>
          [a.name, a.role, a.summary, a.model, ...a.tools]
            .join(" ")
            .toLowerCase()
            .includes(q),
        ),
      }))
      .filter((t) => t.agents.length > 0);
  }, [agents.data, query]);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-pixel text-xs tracking-wide" style={{ color: ACCENT }}>
          AI OPERATIONS CENTER
        </h1>
        <p className="mt-1 text-[11px] text-muted-foreground">
          กำลังพล AI ทั้งหมดจากไฟล์ agent บนเครื่อง — ติดตั้งไว้ ไม่ได้กำลังรัน (no execution telemetry)
        </p>
      </div>
      <button
        type="button"
        onClick={agents.refetch}
        aria-label="รีเฟรชข้อมูล"
        className="grid h-8 w-8 place-items-center rounded-sm border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // ---- top-level gates ----
  if (agents.loading && !agents.data) {
    return (
      <PageShell accent={ACCENT}>
        {header}
        <PixelCard title="กำลังโหลด" accent={ACCENT}>
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 animate-pulse rounded bg-white/5" />
            ))}
          </div>
        </PixelCard>
      </PageShell>
    );
  }

  if (agents.error && !agents.data) {
    return (
      <PageShell accent={ACCENT}>
        {header}
        <PixelCard title="เกิดข้อผิดพลาด" accent="#ef4444">
          <div className="text-[11px] text-danger" role="alert">
            โหลด agents ไม่สำเร็จ · {agents.error}
          </div>
        </PixelCard>
      </PageShell>
    );
  }

  if (summary.total === 0) {
    return (
      <PageShell accent={ACCENT}>
        {header}
        <PixelCard title="ไม่พบ agent" accent={ACCENT}>
          <div className="text-[11px] text-muted-foreground">
            ไม่พบไฟล์ agent บนเครื่องนี้ (no agent files found on this host)
          </div>
        </PixelCard>
      </PageShell>
    );
  }

  return (
    <PageShell accent={ACCENT}>
      {header}

      {/* Workforce summary strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <PixelCard title="ทั้งหมด" accent={ACCENT}>
          <div className="text-xl font-semibold tabular-nums">{summary.total}</div>
        </PixelCard>
        <PixelCard title="พร้อมใช้งาน" accent="#22c55e">
          <div className="text-xl font-semibold tabular-nums text-success">
            {summary.available}
          </div>
        </PixelCard>
        <PixelCard title="ERROR" accent="#ef4444">
          <div className="text-xl font-semibold tabular-nums text-danger">
            {summary.errors.length}
          </div>
        </PixelCard>
        <PixelCard title="PROJECT" accent="#3b82f6">
          <div className="text-xl font-semibold tabular-nums">{summary.project}</div>
        </PixelCard>
        <PixelCard title="USER" accent="#3b82f6">
          <div className="text-xl font-semibold tabular-nums">{summary.user}</div>
        </PixelCard>
        <PixelCard title="OVERRIDE" accent="#f2c14e">
          <div className="text-xl font-semibold tabular-nums text-warning">
            {summary.overrides}
          </div>
        </PixelCard>
      </div>

      {/* Filter / search */}
      <PixelCard accent={ACCENT}>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา agent (ชื่อ, บทบาท, tool, model)…"
            aria-label="ค้นหา agent"
            className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </label>
      </PixelCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Team rosters — spans 2 cols on large screens */}
        <div className="space-y-4 lg:col-span-2">
          {filteredTeams.length === 0 ? (
            <PixelCard title="ไม่พบผลลัพธ์" accent={ACCENT}>
              <div className="text-[11px] text-muted-foreground">
                ไม่มี agent ตรงกับ “{query}”
              </div>
            </PixelCard>
          ) : (
            filteredTeams.map((team) => (
              <PixelCard
                key={team.team}
                title={team.label}
                accent={ACCENT}
                right={
                  <span className="text-[10px] text-muted-foreground/70">
                    {team.agents.length}
                  </span>
                }
              >
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                  {team.agents.map((a) => (
                    <AgentCard key={a.id} agent={a} />
                  ))}
                </div>
              </PixelCard>
            ))
          )}
        </div>

        {/* Right rail: error board, scope/source, activity */}
        <div className="space-y-4">
          <PixelCard title="ERROR BOARD" accent="#ef4444">
            {summary.errors.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">
                ไม่มี agent ที่มีปัญหา — ทุกไฟล์อ่านได้
              </div>
            ) : (
              <div className="space-y-1.5">
                {summary.errors.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-sm border border-danger/40 bg-danger/5 px-2 py-1.5"
                  >
                    <div className="text-xs font-medium">{a.name}</div>
                    <div className="text-[10px] text-danger">
                      {a.error ?? "invalid agent file"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PixelCard>

          <PixelCard title="SCOPE / SOURCE" accent="#3b82f6">
            <StatLine label="แหล่งข้อมูล" value={agents.data?.source ?? "—"} />
            {(agents.data?.scopes ?? []).map((s) => (
              <StatLine
                key={s.scope}
                label={`${s.scope} · ${s.readable ? "อ่านได้" : "อ่านไม่ได้"}`}
                value={`${s.count} · ${s.dir}`}
                valueClassName="truncate max-w-[10rem] text-right text-[10px] text-muted-foreground/70"
              />
            ))}
            <div className="mt-2 flex items-center gap-3 text-[9px] text-muted-foreground/70">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#22c55e" }} />
                installed — not currently running
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#ef4444" }} />
                error
              </span>
            </div>
          </PixelCard>

          <PixelCard
            title="ACTIVITY — แก้ไขไฟล์ล่าสุด"
            accent="#a78bfa"
            right={
              <span className="text-[9px] text-muted-foreground/60">last edited</span>
            }
          >
            <div className="space-y-1">
              {recentlyEdited.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-2 border-t border-border/40 py-1 text-[11px] first:border-t-0"
                >
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    {formatEdited(a.updatedAt)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[9px] text-muted-foreground/60">
              * อิงเวลาแก้ไขไฟล์ (mtime) เท่านั้น ไม่ใช่สถานะการทำงานจริง
            </div>
          </PixelCard>
        </div>
      </div>
    </PageShell>
  );
}
