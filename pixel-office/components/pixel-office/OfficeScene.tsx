import type { ReactNode } from "react";
import {
  Coffee,
  Diamond,
  DoorOpen,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import type { AgentsResponse } from "@/types/agent";
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

// Fixed fake tickers for the market wall display. Presentation only — this
// component never receives a live price feed, so these numbers are static
// flavor, not a claim about real markets.
const TICKERS: { symbol: string; change: number }[] = [
  { symbol: "SPY", change: 0.42 },
  { symbol: "QQQ", change: 0.87 },
  { symbol: "VOO", change: 0.38 },
  { symbol: "BTC", change: 1.85 },
  { symbol: "ETH", change: -0.64 },
  { symbol: "NVDA", change: 2.1 },
];

/** A warm parchment/wood "room card" — the cozy stand-in for a dashboard panel. */
function ZoneCard({
  dept,
  title,
  subtitle,
  children,
}: {
  dept: Department;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const theme = DEPARTMENT_THEME[dept];
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border"
      style={{
        borderColor: `${theme.color}40`,
        background: coziBackground(theme.color),
        boxShadow: glowShadow(theme.color),
      }}
    >
      {/* plaque header — small, integrated into the wall rather than a bright box */}
      <div
        className="relative flex items-center justify-between border-b px-3 py-1.5"
        style={{ borderColor: `${theme.color}26`, background: `${theme.color}0d` }}
      >
        <div className="min-w-0">
          <span
            className="truncate font-pixel text-[10px] tracking-wide"
            style={{ color: theme.color }}
          >
            {title}
          </span>
          {subtitle ? (
            <span className="ml-2 truncate text-[9px] text-[#e5d9c3]/50">{subtitle}</span>
          ) : null}
        </div>
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: theme.color, boxShadow: `0 0 4px ${theme.color}` }}
        />
      </div>
      <div className="relative px-2 pb-3 pt-2 sm:px-3">{children}</div>
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
function LobbyStrip() {
  return (
    <div
      className="relative flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 overflow-hidden rounded-lg border border-[#5a4632] px-3 py-2 sm:px-4"
      style={{ background: "linear-gradient(180deg, #3a2c1e, #2a1f16)" }}
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

/** Classic buzzing neon sign — small, tucked into a zone corner as decor. */
function NeonSign() {
  return (
    <div className="hidden shrink-0 items-center gap-1 rounded-sm border border-black/40 bg-black/50 px-2 py-1 sm:flex">
      {NEON_LINES.map((line, i) => (
        <span
          key={line.text}
          className="animate-neon-flicker font-pixel text-[8px] leading-none"
          style={{
            color: line.color,
            textShadow: `0 0 4px ${line.color}`,
            animationDelay: `${i * 0.6}s`,
          }}
        >
          {line.text}
        </span>
      ))}
    </div>
  );
}

/** A real office-asset tile, scaled up and kept crisp. */
function Asset({
  tile,
  size = 56,
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

/** A small wall-mounted "display screen" — the toned-down stand-in for a
 * bright sticky-note KPI card. Reads as office signage, not a dashboard. */
function WallDisplay({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="min-w-0 rounded-sm border bg-black/45 px-2 py-1"
      style={{ borderColor: `${color}33` }}
    >
      <div
        className="animate-monitor-flicker truncate font-pixel text-xs"
        style={{ color, textShadow: `0 0 3px ${color}66` }}
      >
        {value}
      </div>
      <div className="truncate text-[7px] uppercase tracking-wide text-muted-foreground/60">
        {label}
      </div>
    </div>
  );
}

/** A compact market-data display screen, mounted like wall signage. */
function MarketWall() {
  const row = [...TICKERS, ...TICKERS];
  return (
    <div className="overflow-hidden rounded-sm border border-[#22c55e33] bg-black/40">
      <div className="animate-ticker flex w-max gap-4 whitespace-nowrap px-2 py-1 font-pixel text-[9px]">
        {row.map((t, i) => (
          <span key={`${t.symbol}-${i}`} className="flex items-center gap-1">
            <span className="text-[#e5d9c3]/80">{t.symbol}</span>
            <span style={{ color: t.change >= 0 ? "#22c55e" : "#ef4444" }}>
              {t.change >= 0 ? "▲" : "▼"} {Math.abs(t.change).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function IdeMock() {
  return (
    <div className="h-12 w-20 shrink-0 overflow-hidden rounded-sm border border-[#3b82f655] bg-[#0a0e16]">
      <div className="flex items-center gap-1 border-b border-[#3b82f633] bg-[#111827] px-1 py-0.5">
        <span className="h-1 w-1 rounded-full bg-[#ef4444]" />
        <span className="h-1 w-1 rounded-full bg-[#eab308]" />
        <span className="h-1 w-1 rounded-full bg-[#22c55e]" />
      </div>
      <div className="flex flex-col gap-0.5 px-1 py-1">
        {[70, 45, 60].map((w, i) => (
          <div key={i} className="h-[3px] rounded-full bg-[#3b82f6]/50" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

function BuildStatusPill({ ok }: { ok: boolean }) {
  const color = ok ? "#22c55e" : "#ef4444";
  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-sm border px-2 py-1"
      style={{ borderColor: `${color}44`, background: `${color}0d` }}
    >
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full"
        style={{ background: color, boxShadow: `0 0 4px ${color}` }}
      />
      <span className="whitespace-nowrap font-pixel text-[8px]" style={{ color }}>
        {ok ? "BUILD OK" : "BUILD ISSUE"}
      </span>
    </div>
  );
}

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
      className="relative w-full"
      style={{
        background: "linear-gradient(180deg, #1c130c 0%, #2a1c12 35%, #241a11 100%)",
      }}
    >
      {/* real wood-floor tile art, seamlessly repeated behind the zone cards */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: `url(${OFFICE_TILES.floorHerringbone})`,
          backgroundSize: "64px 64px",
          backgroundRepeat: "repeat",
          imageRendering: "pixelated",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-black/60" />

      <div className="relative mx-auto flex w-full max-w-[1100px] flex-col gap-3 p-2 sm:p-4">
        {/* 0. LOBBY — signage, reception/conference/lounge hints, world clocks */}
        <LobbyStrip />

        {/* 1. EXECUTIVE CORNER — CEO desk, gold */}
        <ZoneCard dept="executive" title="EXECUTIVE CORNER" subtitle="AI CEO / Coordinator">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <WallDisplay label="Agents" value={String(allAgents.length)} color="#eab308" />
              <WallDisplay label="Trading" value={String(tradingAgents.length)} color="#22c55e" />
              <WallDisplay label="Dev" value={String(developerAgents.length)} color="#3b82f6" />
              <WallDisplay
                label="Errors"
                value={String(errorCount)}
                color={errorCount ? "#ef4444" : "#22c55e"}
              />
            </div>
            <div className="ml-auto hidden shrink-0 items-center gap-2 sm:flex">
              <Asset tile="meetingTableRound" size={52} />
              <Asset tile="bookshelf" size={52} />
              <Asset tile="windowCity" size={56} />
              <Asset tile="plantLarge" size={48} className="animate-float" />
            </div>
          </div>
          <div className="mt-2 border-t border-[#eab30822] pt-2">
            {ceo ? (
              <TeamGrid agents={[ceo, ...executiveExtra]} emptyLabel="" />
            ) : (
              <div className="flex h-[190px] w-full items-center justify-center rounded border border-dashed border-[#eab30855] px-2 text-center text-[9px] text-muted-foreground/60">
                ai-ceo agent file not found
              </div>
            )}
          </div>
        </ZoneCard>

        {/* 2. TRADING DESK AREA — largest zone, green */}
        <ZoneCard dept="trading" title="TRADING DESK AREA" subtitle="Quant, research, portfolio & risk">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[180px] flex-1">
              <MarketWall />
            </div>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <Asset tile="meetingTableRound" size={48} />
              <Asset tile="plantWindow" size={48} className="animate-float" />
              <Asset tile="windowCity" size={52} />
            </div>
          </div>
          <div className="mt-2 border-t border-[#22c55e22] pt-2">
            <TeamGrid agents={tradingAgents} emptyLabel="No trading agents installed" />
          </div>
        </ZoneCard>

        {/* 3. DEVELOPER DESKS — blue/cyan */}
        <ZoneCard dept="developer" title="DEVELOPER DESKS" subtitle="Engineering, QA, security & platform">
          <div className="flex flex-wrap items-center gap-2">
            <IdeMock />
            <BuildStatusPill ok={devErrorCount === 0} />
            <div className="hidden items-center gap-2 sm:flex">
              <NeonSign />
              <Asset tile="serverRackDouble" size={52} />
              <Asset tile="bookshelf" size={48} />
              <Asset tile="plantWindow" size={44} className="animate-float" />
            </div>
          </div>
          <div className="mt-2 border-t border-[#3b82f622] pt-2">
            <TeamGrid agents={developerAgents} emptyLabel="No developer agents installed" />
          </div>
        </ZoneCard>
      </div>
    </div>
  );
}
