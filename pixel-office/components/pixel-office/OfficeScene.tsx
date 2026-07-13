import type { ReactNode } from "react";
import {
  Coffee,
  Diamond,
  DoorOpen,
  Presentation,
  Sprout,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { AgentsResponse } from "@/types/agent";
import { AgentAvatar } from "./AgentAvatar";
import { TeamGrid } from "./OfficeWorkers";
import { WorldClocks } from "./WorldClocks";
import {
  DEPARTMENT_THEME,
  coziBackground,
  glowShadow,
  type Department,
} from "./department-theme";

// Fixed fake tickers/heatmap for the market wall. Presentation only — this
// component never receives a live price feed, so these numbers are static
// flavor, not a claim about real markets.
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

/** A warm parchment/wood "room card" — the cozy stand-in for a dashboard panel. */
function ZoneCard({
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
      className="absolute overflow-hidden rounded-xl border-2"
      style={{
        left,
        top,
        width,
        height,
        borderColor: `${theme.color}66`,
        background: coziBackground(theme.color),
        boxShadow: glowShadow(theme.color),
      }}
    >
      {/* premium glass sheen — static width, slow drift, never affects layout */}
      <div
        className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/4 w-1/2 opacity-[0.04]"
        style={{
          background:
            "linear-gradient(115deg, transparent 20%, #ffffff 50%, transparent 80%)",
        }}
      />
      {/* hanging wooden plaque */}
      <div className="relative flex items-center justify-between px-4 pb-2 pt-3">
        <div className="min-w-0">
          <div
            className="inline-block truncate rounded-sm border px-2 py-0.5 font-pixel text-[11px] tracking-wide"
            style={{
              color: theme.color,
              borderColor: `${theme.color}55`,
              background: "rgba(0,0,0,0.28)",
              textShadow: `0 0 8px ${theme.color}aa`,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div className="mt-1 truncate text-[9px] text-[#e5d9c3]/70">{subtitle}</div>
          ) : null}
        </div>
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: theme.color, boxShadow: `0 0 6px ${theme.color}` }}
        />
      </div>
      <div
        className="scrollbar-thin relative overflow-y-auto px-4 pb-3"
        style={{ height: "calc(100% - 58px)" }}
      >
        {children}
      </div>
    </div>
  );
}

function AmenityPill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full border border-[#e5d9c3]/20 bg-black/20 px-2 py-0.5 text-[8px] uppercase tracking-wide text-[#e5d9c3]/70">
      <Icon className="h-2.5 w-2.5" /> {label}
    </span>
  );
}

/** Reception hint, signage, and amenity tags — the "lobby" above the floors. */
function LobbyStrip({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  return (
    <div
      className="absolute flex items-center justify-between gap-3 overflow-hidden rounded-xl border-2 border-[#5a4632] px-4"
      style={{
        left,
        top,
        width,
        height,
        background: "linear-gradient(180deg, #3a2c1e, #2a1f16)",
      }}
    >
      <div className="flex shrink-0 items-center gap-2">
        <Diamond className="h-3.5 w-3.5 text-[#eab308]" strokeWidth={2.5} />
        <span className="whitespace-nowrap font-pixel text-[11px] tracking-wide text-[#f2e6c9]">
          AXIOM CAPITAL <span className="text-[#c9a86a]/70">· AI OPS</span>
        </span>
      </div>
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <AmenityPill icon={DoorOpen} label="Reception" />
        <AmenityPill icon={Presentation} label="Conference" />
        <AmenityPill icon={Coffee} label="Lounge" />
      </div>
      <WorldClocks />
    </div>
  );
}

const NEON_LINES: { text: string; color: string }[] = [
  { text: "EAT", color: "#ff3b6a" },
  { text: "SLEEP", color: "#ffd23b" },
  { text: "CODE", color: "#3bff7a" },
  { text: "TRADE", color: "#3bd6ff" },
];

/** Classic buzzing neon sign — pure decor, tucked in a zone corner. */
function NeonSign() {
  return (
    <div className="hidden shrink-0 flex-col gap-0.5 rounded-md border-2 border-black/40 bg-black/50 px-3 py-2 sm:flex">
      {NEON_LINES.map((line, i) => (
        <span
          key={line.text}
          className="animate-neon-flicker font-pixel text-[10px] leading-none"
          style={{
            color: line.color,
            textShadow: `0 0 6px ${line.color}, 0 0 14px ${line.color}`,
            animationDelay: `${i * 0.6}s`,
          }}
        >
          {line.text}
        </span>
      ))}
    </div>
  );
}

/** Large window with a city-skyline silhouette, blinds, and a slow light shimmer. */
function CityWindow({ wide = false }: { wide?: boolean }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-md border-4 border-[#4a3320] ${wide ? "h-16 w-40" : "h-16 w-24"}`}
      style={{ background: "linear-gradient(180deg, #2d3f5c 0%, #6d87ab 55%, #cfe0ef 100%)" }}
    >
      <div
        className="absolute inset-0 opacity-90"
        style={{
          clipPath:
            "polygon(0% 100%, 0% 62%, 8% 62%, 8% 45%, 16% 45%, 16% 70%, 26% 70%, 26% 30%, 34% 30%, 34% 58%, 44% 58%, 44% 40%, 54% 40%, 54% 66%, 64% 66%, 64% 20%, 74% 20%, 74% 62%, 84% 62%, 84% 48%, 100% 48%, 100% 100%)",
          background: "#1c2740",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-full bg-[repeating-linear-gradient(0deg,rgba(20,14,8,0.35)_0px,rgba(20,14,8,0.35)_3px,transparent_3px,transparent_16px)]" />
      <div className="animate-sheen absolute inset-y-0 -left-1/3 w-1/3 bg-white/15" />
    </div>
  );
}

function Bookshelf() {
  const colors = ["#c94f4f", "#4f8cc9", "#e0b03b", "#4fbf7a", "#9a5fc9"];
  return (
    <div className="grid shrink-0 grid-cols-4 grid-rows-2 gap-1 rounded-sm border-2 border-[#5a4632] bg-[#3a2c1e] p-1.5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-4 w-2.5 rounded-[1px]"
          style={{ background: colors[i % colors.length], opacity: 0.88 }}
        />
      ))}
    </div>
  );
}

function Plant() {
  return (
    <div className="animate-float flex shrink-0 flex-col items-center">
      <div className="h-4 w-4 rounded-full bg-[#3a9159]" />
      <div className="-mt-1.5 h-3 w-3 rounded-full bg-[#2f7a4a]" />
      <div className="h-2 w-3 rounded-b-sm bg-[#7a5a3a]" />
    </div>
  );
}

function TrophyShelf() {
  return (
    <div className="flex shrink-0 items-end gap-1 rounded-sm border border-[#eab30833] bg-black/20 px-2 py-1">
      <Trophy className="h-4 w-4 text-[#eab308]" />
      <span className="font-pixel text-[7px] uppercase tracking-wide text-[#eab308]/70">
        MVP
      </span>
    </div>
  );
}

function WaterCooler() {
  return (
    <div className="flex shrink-0 flex-col items-center">
      <div className="h-3 w-3 rounded-full bg-[#8fd0ee] opacity-90" />
      <div className="-mt-0.5 h-4 w-4 rounded-sm bg-[#dfeff7]" />
      <div className="h-2 w-5 rounded-sm bg-[#c9dbe6]" />
    </div>
  );
}

function MarketWall() {
  const row = [...TICKERS, ...TICKERS];
  return (
    <div className="overflow-hidden rounded-sm border border-[#22c55e44] bg-black/35">
      <div className="animate-ticker flex w-max gap-6 whitespace-nowrap px-3 py-1.5 font-pixel text-[10px]">
        {row.map((t, i) => (
          <span key={`${t.symbol}-${i}`} className="flex items-center gap-1">
            <span className="text-[#f2e6c9]">{t.symbol}</span>
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
    <div className="flex items-center gap-1.5 rounded-full border border-[#eab30855] bg-black/30 px-2 py-1">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#22c55e]" />
      <span className="font-pixel text-[8px] tracking-wide text-[#fde68a]">
        SESSION ACTIVE
      </span>
    </div>
  );
}

/** A rotated sticky-note stat tile for the mission corkboard. */
function StickyNote({
  label,
  value,
  color,
  small,
  rotate,
}: {
  label: string;
  value: string;
  color: string;
  small?: boolean;
  rotate: number;
}) {
  return (
    <div
      className="relative min-w-0 rounded-sm border bg-[#fdf6e3] px-2 py-1.5 shadow-[0_3px_6px_rgba(0,0,0,0.35)]"
      style={{ borderColor: `${color}55`, transform: `rotate(${rotate}deg)` }}
    >
      <span
        className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full border border-black/30"
        style={{ background: color }}
      />
      <div
        className={`truncate font-pixel ${small ? "text-[9px]" : "text-sm"}`}
        style={{ color: "#3a2c1e" }}
      >
        {value}
      </div>
      <div className="truncate text-[8px] uppercase tracking-wide text-[#5a4632]/80">
        {label}
      </div>
    </div>
  );
}

/** Decorative, non-numeric mini release/QA pulse for the mission corkboard. */
function MissionPulseChart({ color }: { color: string }) {
  return (
    <div
      className="relative h-full min-h-[44px] w-full overflow-hidden rounded-sm border bg-black/30"
      style={{ borderColor: `${color}44` }}
    >
      <svg viewBox="0 0 100 30" className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <polyline
          points="0,22 10,18 20,24 30,12 40,17 50,8 60,15 70,6 80,13 90,9 100,14"
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          className="animate-chart-scan"
        />
      </svg>
      <span className="absolute bottom-1 left-1.5 text-[7px] uppercase tracking-wide text-muted-foreground/50">
        mission pulse (decorative)
      </span>
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
          <div key={i} className="h-1 rounded-full bg-[#3b82f6]/50" style={{ width: `${w}%` }} />
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
        className="h-2 w-2 animate-pulse rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span className="whitespace-nowrap font-pixel text-[8px]" style={{ color }}>
        {ok ? "BUILD OK" : "BUILD ISSUE"}
      </span>
    </div>
  );
}

function CoffeeCorner() {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-sm border border-[#3b82f655] bg-black/30 px-3 py-1.5">
      <Coffee className="h-3.5 w-3.5 text-[#93c5fd]" />
      <span className="whitespace-nowrap font-pixel text-[8px] text-[#93c5fd]">BREAK AREA</span>
    </div>
  );
}

/** Server rack column with blinking LEDs, linked by a decorative data pulse. */
function ServerRack({ racks = 3 }: { racks?: number }) {
  return (
    <div className="relative flex gap-2">
      <svg
        className="pointer-events-none absolute -top-3 left-0 h-3 w-full"
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
      >
        <line x1="8" y1="6" x2="92" y2="6" stroke="#f9731655" strokeWidth={1} />
        <circle cx="20" cy="6" r="1.6" fill="#f97316" className="animate-node-pulse" />
        <circle
          cx="50"
          cy="6"
          r="1.6"
          fill="#f97316"
          className="animate-node-pulse"
          style={{ animationDelay: "0.5s" }}
        />
        <circle
          cx="80"
          cy="6"
          r="1.6"
          fill="#f97316"
          className="animate-node-pulse"
          style={{ animationDelay: "1s" }}
        />
      </svg>
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
const LOBBY_TOP = 20;
const LOBBY_HEIGHT = 54;
const EXEC_TOP = 94;
const EXEC_HEIGHT = 260;
const TRADING_TOP = 374;
const TRADING_HEIGHT = 640;
const DEV_TOP = 1034;
const DEV_HEIGHT = 490;
const OPS_TOP = 1544;
const OPS_HEIGHT = 260;
const INFRA_TOP = 1824;
const INFRA_HEIGHT = 200;

export function OfficeScene({ agents }: { agents: AgentsResponse | null }) {
  const tradingAgents = agents?.teams.find((t) => t.team === "trading")?.agents ?? [];
  const developerAgents = agents?.teams.find((t) => t.team === "developer")?.agents ?? [];
  const otherAgents = agents?.teams.find((t) => t.team === "other")?.agents ?? [];
  const ceo = otherAgents.find((a) => a.name.trim().toLowerCase() === "ai-ceo") ?? null;
  const executiveExtra = otherAgents.filter((a) => a !== ceo);

  const allAgents = [...tradingAgents, ...developerAgents, ...otherAgents];
  const errorCount = allAgents.filter((a) => a.status === "error").length;
  const availableCount = allAgents.length - errorCount;
  const devErrorCount = developerAgents.filter((a) => a.status === "error").length;

  const scopeSummary =
    agents?.scopes.map((s) => `${s.scope}: ${s.readable ? s.count : "n/a"}`).join("  ·  ") ||
    "n/a";

  return (
    <div
      className="relative h-full w-full"
      style={{
        background: "linear-gradient(180deg, #1c130c 0%, #2a1c12 35%, #241a11 100%)",
      }}
    >
      {/* warm wooden floor with a faint isometric diamond tile weave */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.09]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(60deg, #f2c98f 0px, #f2c98f 1px, transparent 1px, transparent 42px), repeating-linear-gradient(-60deg, #f2c98f 0px, #f2c98f 1px, transparent 1px, transparent 42px)",
        }}
      />

      {/* 0. LOBBY — signage, reception/conference/lounge hints, world clocks */}
      <LobbyStrip left={FLOOR_LEFT} top={LOBBY_TOP} width={FLOOR_WIDTH} height={LOBBY_HEIGHT} />

      {/* 1. EXECUTIVE CORNER — CEO desk, gold */}
      <ZoneCard
        dept="executive"
        left={FLOOR_LEFT}
        top={EXEC_TOP}
        width={FLOOR_WIDTH}
        height={EXEC_HEIGHT}
        title="EXECUTIVE CORNER"
        subtitle="AI CEO / Coordinator — assigns work, merges results, approves output"
      >
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex shrink-0 flex-col items-center gap-2">
            {ceo ? (
              <AgentAvatar agent={ceo} />
            ) : (
              <div className="flex h-[214px] w-[128px] items-center justify-center rounded border border-dashed border-[#eab30855] px-2 text-center text-[9px] text-muted-foreground/60">
                ai-ceo agent file not found
              </div>
            )}
            <SessionBell />
          </div>
          <div className="grid flex-1 grid-cols-4 gap-2 self-start">
            <StickyNote label="Total Agents" value={String(allAgents.length)} color="#eab308" rotate={-1.5} />
            <StickyNote label="Trading Desk" value={String(tradingAgents.length)} color="#22c55e" rotate={1} />
            <StickyNote label="Developer Desk" value={String(developerAgents.length)} color="#3b82f6" rotate={-1} />
            <StickyNote
              label="Errors"
              value={String(errorCount)}
              color={errorCount ? "#ef4444" : "#22c55e"}
              rotate={1.5}
            />
          </div>
          <TrophyShelf />
          <Bookshelf />
        </div>
        {executiveExtra.length > 0 ? (
          <div className="mt-3 border-t border-[#eab30822] pt-2">
            <div className="mb-1 font-pixel text-[9px] uppercase tracking-wide text-[#fde68a]/80">
              Executive Staff
            </div>
            <TeamGrid agents={executiveExtra} columns={6} emptyLabel="" />
          </div>
        ) : null}
      </ZoneCard>

      {/* 2. TRADING DESK AREA — largest zone, green */}
      <ZoneCard
        dept="trading"
        left={FLOOR_LEFT}
        top={TRADING_TOP}
        width={FLOOR_WIDTH}
        height={TRADING_HEIGHT}
        title="TRADING DESK AREA"
        subtitle="Quant, research, portfolio & risk desks"
      >
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-[260px] flex-1">
            <MarketWall />
          </div>
          <CityWindow />
          <Plant />
        </div>
        <div className="mt-3">
          <TeamGrid agents={tradingAgents} columns={6} emptyLabel="No trading agents installed" />
        </div>
      </ZoneCard>

      {/* 3. DEVELOPER DESKS — blue/cyan */}
      <ZoneCard
        dept="developer"
        left={FLOOR_LEFT}
        top={DEV_TOP}
        width={FLOOR_WIDTH}
        height={DEV_HEIGHT}
        title="DEVELOPER DESKS"
        subtitle="Engineering, QA, security & platform desks"
      >
        <div className="flex flex-wrap items-center gap-3">
          <IdeMock />
          <TerminalMock />
          <BuildStatusPill ok={devErrorCount === 0} />
          <CoffeeCorner />
          <NeonSign />
          <WaterCooler />
        </div>
        <div className="mt-3">
          <TeamGrid agents={developerAgents} columns={6} emptyLabel="No developer agents installed" />
        </div>
      </ZoneCard>

      {/* 4. OPERATIONS WALL — mission corkboard, purple, existing data only */}
      <ZoneCard
        dept="operations"
        left={FLOOR_LEFT}
        top={OPS_TOP}
        width={FLOOR_WIDTH}
        height={OPS_HEIGHT}
        title="OPERATIONS WALL"
        subtitle="Mission board — live agent roster health"
      >
        <div
          className="rounded-md border border-[#5a4632] p-3"
          style={{
            background:
              "radial-gradient(#00000022 1px, transparent 1px) 0 0/10px 10px, #6b4a2f",
          }}
        >
          <div className="grid grid-cols-5 gap-3">
            <StickyNote label="Online" value={`${availableCount}/${allAgents.length}`} color="#a855f7" rotate={-1.5} />
            <StickyNote
              label="Errors Detected"
              value={String(errorCount)}
              color={errorCount ? "#ef4444" : "#a855f7"}
              rotate={1}
            />
            <StickyNote label="Data Source" value={agents?.source ?? "n/a"} color="#a855f7" rotate={-1} />
            <StickyNote label="Scopes" value={scopeSummary} small color="#a855f7" rotate={1.5} />
            <MissionPulseChart color="#a855f7" />
          </div>
        </div>
        <div className="mt-3 text-[9px] text-muted-foreground/60">
          Last sync: {agents ? new Date(agents.generatedAt).toLocaleString() : "—"}
        </div>
      </ZoneCard>

      {/* 5. SERVER / STORAGE CORNER — small, orange */}
      <ZoneCard
        dept="infrastructure"
        left={FLOOR_LEFT}
        top={INFRA_TOP}
        width={FLOOR_WIDTH}
        height={INFRA_HEIGHT}
        title="SERVER & STORAGE CORNER"
        subtitle="Server & AI cluster"
      >
        <div className="flex flex-wrap items-center gap-8 pt-2">
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
          <Sprout className="h-5 w-5 shrink-0 text-[#22c55e]/50" />
        </div>
      </ZoneCard>
    </div>
  );
}
