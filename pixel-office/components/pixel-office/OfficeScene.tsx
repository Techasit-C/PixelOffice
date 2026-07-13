import type { ReactNode } from "react";
import type { AgentsResponse } from "@/types/agent";
import { AgentAvatar } from "./AgentAvatar";
import { TeamGrid } from "./OfficeWorkers";
import { DEPARTMENT_THEME, type Department } from "./department-theme";

// Fixed fake tickers/heatmap for the Bloomberg-style market wall. Presentation
// only — this component never receives a live price feed, so these numbers
// are static flavor, not a claim about real markets.
const TICKERS: { symbol: string; change: number }[] = [
  { symbol: "SPY", change: 0.42 },
  { symbol: "QQQ", change: 0.87 },
  { symbol: "VOO", change: 0.38 },
  { symbol: "SCHD", change: -0.12 },
  { symbol: "BTC", change: 1.85 },
  { symbol: "ETH", change: -0.64 },
  { symbol: "NVDA", change: 2.1 },
  { symbol: "AAPL", change: 0.21 },
  { symbol: "O", change: -0.35 },
  { symbol: "DXY", change: 0.08 },
];

function FloorPanel({
  dept,
  left,
  top,
  width,
  height,
  title,
  subtitle,
  children,
}: {
  dept: Department;
  left: number;
  top: number;
  width: number;
  height: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const theme = DEPARTMENT_THEME[dept];
  return (
    <div
      className="absolute overflow-hidden rounded-md border backdrop-blur-sm"
      style={{
        left,
        top,
        width,
        height,
        borderColor: `${theme.color}55`,
        background: `linear-gradient(180deg, ${theme.color}14, rgba(6,9,15,0.92) 42%)`,
        boxShadow: `0 0 24px ${theme.color}22, inset 0 0 40px ${theme.color}0d`,
      }}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-2"
        style={{ borderColor: `${theme.color}33`, background: `${theme.color}12` }}
      >
        <div className="min-w-0">
          <div
            className="truncate font-pixel text-[11px] tracking-wide"
            style={{ color: theme.color, textShadow: `0 0 8px ${theme.color}aa` }}
          >
            {title}
          </div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-[9px] text-muted-foreground/70">
              {subtitle}
            </div>
          ) : null}
        </div>
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: theme.color, boxShadow: `0 0 6px ${theme.color}` }}
        />
      </div>
      <div
        className="scrollbar-thin overflow-y-auto px-4 py-3"
        style={{ height: "calc(100% - 46px)" }}
      >
        {children}
      </div>
    </div>
  );
}

function MarketWall() {
  const row = [...TICKERS, ...TICKERS];
  return (
    <div className="overflow-hidden rounded-sm border border-[#22c55e33] bg-black/40">
      <div className="animate-ticker flex w-max gap-6 whitespace-nowrap px-3 py-1.5 font-pixel text-[10px]">
        {row.map((t, i) => (
          <span key={`${t.symbol}-${i}`} className="flex items-center gap-1">
            <span className="text-[#e5e7eb]">{t.symbol}</span>
            <span style={{ color: t.change >= 0 ? "#22c55e" : "#ef4444" }}>
              {t.change >= 0 ? "▲" : "▼"} {Math.abs(t.change).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-10 gap-[2px] border-t border-[#22c55e22] p-1.5">
        {TICKERS.map((t) => (
          <div
            key={t.symbol}
            className="h-3 rounded-[1px]"
            style={{
              background: t.change >= 0 ? "#16a34a" : "#dc2626",
              opacity: 0.35 + Math.abs(t.change) / 3,
            }}
            title={`${t.symbol} ${t.change >= 0 ? "+" : ""}${t.change}%`}
          />
        ))}
      </div>
    </div>
  );
}

function SessionBell() {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-[#eab30855] bg-black/40 px-2 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e] animate-pulse" />
      <span className="font-pixel text-[8px] tracking-wide text-[#fde68a]">
        SESSION ACTIVE
      </span>
    </div>
  );
}

function StatTile({
  label,
  value,
  color,
  small,
}: {
  label: string;
  value: string;
  color: string;
  small?: boolean;
}) {
  return (
    <div
      className="min-w-0 rounded-sm border bg-black/40 px-2 py-1.5"
      style={{ borderColor: `${color}44` }}
    >
      <div
        className={`truncate font-pixel ${small ? "text-[9px]" : "text-sm"}`}
        style={{ color, textShadow: `0 0 6px ${color}88` }}
      >
        {value}
      </div>
      <div className="truncate text-[8px] uppercase tracking-wide text-muted-foreground/70">
        {label}
      </div>
    </div>
  );
}

function IdeMock() {
  return (
    <div className="h-16 w-28 shrink-0 overflow-hidden rounded-sm border border-[#3b82f655] bg-[#0a0e16]">
      <div className="flex items-center gap-1 border-b border-[#3b82f633] bg-[#111827] px-1.5 py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-[#ef4444]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#eab308]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
      </div>
      <div className="flex flex-col gap-1 px-1.5 py-1.5">
        {[70, 45, 60, 30].map((w, i) => (
          <div
            key={i}
            className="h-1 rounded-full bg-[#3b82f6]/50"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function TerminalMock() {
  return (
    <div className="h-16 w-28 shrink-0 overflow-hidden rounded-sm border border-[#3b82f655] bg-black/60 px-1.5 py-1.5 font-mono text-[8px] text-[#4ade80]">
      <div>$ npm run build</div>
      <div className="text-[#93c5fd]">compiling…</div>
      <div className="flex items-center gap-0.5">
        <span>$</span>
        <span className="animate-caret">_</span>
      </div>
    </div>
  );
}

function BuildStatusPill({ ok }: { ok: boolean }) {
  const color = ok ? "#22c55e" : "#ef4444";
  return (
    <div
      className="flex shrink-0 flex-col items-center gap-1 rounded-sm border px-3 py-1.5"
      style={{ borderColor: `${color}55`, background: `${color}11` }}
    >
      <span
        className="h-2 w-2 rounded-full animate-pulse"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span className="whitespace-nowrap font-pixel text-[8px]" style={{ color }}>
        {ok ? "BUILD OK" : "BUILD ISSUE"}
      </span>
    </div>
  );
}

function ServerRack({ racks = 3 }: { racks?: number }) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: racks }).map((_, r) => (
        <div
          key={r}
          className="flex w-10 flex-col gap-1 rounded-sm border border-[#f9731655] bg-[#0a0e16] p-1.5"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-[1px] bg-black/60 px-1 py-0.5"
            >
              <span className="h-1 w-3 rounded-full bg-[#f97316]/30" />
              <span
                className="animate-led h-1.5 w-1.5 rounded-full bg-[#22c55e]"
                style={{ animationDelay: `${(r * 5 + i) * 0.15}s` }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const FLOOR_LEFT = 340;
const FLOOR_WIDTH = 1000;

export function OfficeScene({ agents }: { agents: AgentsResponse | null }) {
  const tradingAgents =
    agents?.teams.find((t) => t.team === "trading")?.agents ?? [];
  const developerAgents =
    agents?.teams.find((t) => t.team === "developer")?.agents ?? [];
  const otherAgents = agents?.teams.find((t) => t.team === "other")?.agents ?? [];
  const ceo =
    otherAgents.find((a) => a.name.trim().toLowerCase() === "ai-ceo") ?? null;
  const executiveExtra = otherAgents.filter((a) => a !== ceo);

  const allAgents = [...tradingAgents, ...developerAgents, ...otherAgents];
  const errorCount = allAgents.filter((a) => a.status === "error").length;
  const availableCount = allAgents.length - errorCount;
  const devErrorCount = developerAgents.filter((a) => a.status === "error").length;

  const scopeSummary =
    agents?.scopes
      .map((s) => `${s.scope}: ${s.readable ? s.count : "n/a"}`)
      .join("  ·  ") || "n/a";

  return (
    <div
      className="relative h-full w-full"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%, #0d1420 0%, #060a12 55%, #030509 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(#7dd3fc 1px, transparent 1px), linear-gradient(90deg, #7dd3fc 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* 1. EXECUTIVE COMMAND CENTER */}
      <FloorPanel
        dept="executive"
        left={FLOOR_LEFT}
        top={20}
        width={FLOOR_WIDTH}
        height={230}
        title="EXECUTIVE COMMAND CENTER"
        subtitle="AI CEO / Coordinator — assigns work, merges results, approves output"
      >
        <div className="flex gap-4">
          <div className="flex shrink-0 flex-col items-center gap-2">
            {ceo ? (
              <AgentAvatar agent={ceo} />
            ) : (
              <div className="flex h-[168px] w-[128px] items-center justify-center rounded border border-dashed border-[#eab30855] px-2 text-center text-[9px] text-muted-foreground/60">
                ai-ceo agent file not found
              </div>
            )}
            <SessionBell />
          </div>
          <div className="grid flex-1 grid-cols-4 gap-2 self-start">
            <StatTile label="Total Agents" value={String(allAgents.length)} color="#eab308" />
            <StatTile label="Trading Desk" value={String(tradingAgents.length)} color="#22c55e" />
            <StatTile label="Developer Desk" value={String(developerAgents.length)} color="#3b82f6" />
            <StatTile
              label="Errors"
              value={String(errorCount)}
              color={errorCount ? "#ef4444" : "#22c55e"}
            />
          </div>
        </div>
        {executiveExtra.length > 0 ? (
          <div className="mt-3 border-t border-[#eab30822] pt-2">
            <div className="mb-1 font-pixel text-[9px] uppercase tracking-wide text-[#fde68a]/80">
              Executive Staff
            </div>
            <TeamGrid agents={executiveExtra} columns={6} emptyLabel="" />
          </div>
        ) : null}
      </FloorPanel>

      {/* 2. TRADING FLOOR — largest area */}
      <FloorPanel
        dept="trading"
        left={FLOOR_LEFT}
        top={270}
        width={FLOOR_WIDTH}
        height={560}
        title="TRADING FLOOR"
        subtitle="Quant, research, portfolio & risk desks"
      >
        <MarketWall />
        <div className="mt-3">
          <TeamGrid agents={tradingAgents} columns={6} emptyLabel="No trading agents installed" />
        </div>
      </FloorPanel>

      {/* 3. DEVELOPER FLOOR */}
      <FloorPanel
        dept="developer"
        left={FLOOR_LEFT}
        top={850}
        width={FLOOR_WIDTH}
        height={430}
        title="DEVELOPER FLOOR"
        subtitle="Engineering, QA, security & platform desks"
      >
        <div className="flex flex-wrap items-center gap-3">
          <IdeMock />
          <TerminalMock />
          <BuildStatusPill ok={devErrorCount === 0} />
        </div>
        <div className="mt-3">
          <TeamGrid agents={developerAgents} columns={6} emptyLabel="No developer agents installed" />
        </div>
      </FloorPanel>

      {/* 4. OPERATIONS CENTER — mission control, existing data only */}
      <FloorPanel
        dept="operations"
        left={FLOOR_LEFT}
        top={1300}
        width={FLOOR_WIDTH}
        height={240}
        title="OPERATIONS CENTER"
        subtitle="Mission control — live agent roster health"
      >
        <div className="grid grid-cols-4 gap-2">
          <StatTile label="Online" value={`${availableCount}/${allAgents.length}`} color="#a855f7" />
          <StatTile
            label="Errors Detected"
            value={String(errorCount)}
            color={errorCount ? "#ef4444" : "#a855f7"}
          />
          <StatTile label="Data Source" value={agents?.source ?? "n/a"} color="#a855f7" />
          <StatTile label="Scopes" value={scopeSummary} small color="#a855f7" />
        </div>
        <div className="mt-3 text-[9px] text-muted-foreground/60">
          Last sync: {agents ? new Date(agents.generatedAt).toLocaleString() : "—"}
        </div>
      </FloorPanel>

      {/* 5. INFRASTRUCTURE ROOM — small glass server room */}
      <FloorPanel
        dept="infrastructure"
        left={FLOOR_LEFT}
        top={1560}
        width={FLOOR_WIDTH}
        height={170}
        title="INFRASTRUCTURE ROOM"
        subtitle="Server & AI cluster"
      >
        <div className="flex items-center gap-6">
          <ServerRack racks={3} />
          <div className="flex flex-col gap-2 text-[9px] text-muted-foreground/70">
            <div className="flex items-center gap-1.5">
              <span className="animate-led h-1.5 w-1.5 rounded-full bg-[#f97316]" />
              DB CLUSTER — nominal
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="animate-led h-1.5 w-1.5 rounded-full bg-[#f97316]"
                style={{ animationDelay: "0.3s" }}
              />
              AI CLUSTER — nominal
            </div>
          </div>
        </div>
      </FloorPanel>
    </div>
  );
}
