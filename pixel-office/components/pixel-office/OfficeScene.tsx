import type { ReactNode } from "react";
import {
  Coffee,
  Diamond,
  DoorOpen,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import type { AgentsResponse } from "@/types/agent";
import { AgentAvatar } from "./AgentAvatar";
import { TeamGrid } from "./OfficeWorkers";
import { WorldClocks } from "./WorldClocks";
import { OfficeAsset } from "./OfficeAsset";
import { OFFICE_TILES } from "./office-assets";
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

/** A real office-asset tile, scaled up and kept crisp — the standard way
 * every piece of furniture/decor in this scene is rendered. */
function Asset({
  tile,
  size = 64,
  className = "",
}: {
  tile: keyof typeof OFFICE_TILES;
  size?: number;
  className?: string;
}) {
  return (
    <OfficeAsset
      src={OFFICE_TILES[tile]}
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
    />
  );
}

/** A real conference table + label — the "meeting room" corner. */
function MeetingRoom({ tile = "conferenceTableLong" }: { tile?: "conferenceTableLong" | "meetingTableRound" }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <Asset tile={tile} size={72} />
      <span className="font-pixel text-[7px] uppercase tracking-wide text-[#e5d9c3]/70">
        Conference
      </span>
    </div>
  );
}

/** A reception-style counter + label — used for the coffee/lounge corner too. */
function LoungeCounter({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <Asset tile="receptionDesk" size={64} />
      <span className="flex items-center gap-1 font-pixel text-[7px] uppercase tracking-wide text-[#e5d9c3]/70">
        <Coffee className="h-2.5 w-2.5" /> {label}
      </span>
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

/** A rotated sticky-note stat tile for the corkboard-style KPI row. */
function StickyNote({
  label,
  value,
  color,
  rotate,
}: {
  label: string;
  value: string;
  color: string;
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
      <div className="truncate font-pixel text-sm" style={{ color: "#3a2c1e" }}>
        {value}
      </div>
      <div className="truncate text-[8px] uppercase tracking-wide text-[#5a4632]/80">
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

export function OfficeScene({ agents }: { agents: AgentsResponse | null }) {
  const tradingAgents = agents?.teams.find((t) => t.team === "trading")?.agents ?? [];
  const developerAgents = agents?.teams.find((t) => t.team === "developer")?.agents ?? [];
  const otherAgents = agents?.teams.find((t) => t.team === "other")?.agents ?? [];
  const ceo = otherAgents.find((a) => a.name.trim().toLowerCase() === "ai-ceo") ?? null;
  const executiveExtra = otherAgents.filter((a) => a !== ceo);

  const allAgents = [...tradingAgents, ...developerAgents, ...otherAgents];
  const errorCount = allAgents.filter((a) => a.status === "error").length;
  const devErrorCount = developerAgents.filter((a) => a.status === "error").length;

  return (
    <div
      className="relative h-full w-full"
      style={{
        background: "linear-gradient(180deg, #1c130c 0%, #2a1c12 35%, #241a11 100%)",
      }}
    >
      {/* real wood-floor tile art, seamlessly repeated — replaces the old CSS
          diamond-line approximation. Low opacity so it reads as flooring
          peeking through the gaps between zone cards, not a busy backdrop. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: `url(${OFFICE_TILES.floorHerringbone})`,
          backgroundSize: "64px 64px",
          backgroundRepeat: "repeat",
          imageRendering: "pixelated",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-black/55" />

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
          <MeetingRoom tile="meetingTableRound" />
          <Asset tile="bookshelf" size={72} />
          <Asset tile="filingCabinet" size={64} />
          <Asset tile="windowCity" size={80} />
          <Asset tile="plantLarge" size={64} className="animate-float" />
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
          <Asset tile="windowCity" size={80} />
          <Asset tile="plantWindow" size={64} className="animate-float" />
          <MeetingRoom tile="conferenceTableLong" />
          <LoungeCounter label="Coffee Bar" />
          <Asset tile="plantLarge" size={64} className="animate-float" />
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
          <LoungeCounter label="Break Area" />
          <NeonSign />
          <Asset tile="serverRackDouble" size={72} />
          <Asset tile="bookshelf" size={72} />
          <Asset tile="plantWindow" size={64} className="animate-float" />
        </div>
        <div className="mt-3">
          <TeamGrid agents={developerAgents} columns={6} emptyLabel="No developer agents installed" />
        </div>
      </ZoneCard>
    </div>
  );
}
