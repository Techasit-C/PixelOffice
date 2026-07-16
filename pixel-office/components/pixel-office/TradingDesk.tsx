import type { LucideIcon } from "lucide-react";
import type { DeskKind } from "./role-visuals";
import { OfficeAsset } from "./OfficeAsset";
import { DESK_TILE_BY_MONITOR_COUNT, OFFICE_TILES } from "./office-assets";

/** Small, purely decorative motion motif layered over the desk's screen. */
function ScreenMotif({ kind, glow }: { kind: DeskKind; glow: string }) {
  switch (kind) {
    case "chart":
    case "hologram":
      return (
        <svg viewBox="0 0 30 20" className="absolute inset-0 h-full w-full">
          <polyline
            points="0,16 5,10 10,13 15,6 20,9 25,3 30,7"
            fill="none"
            stroke={glow}
            strokeWidth={1.4}
            className="animate-chart-scan"
          />
        </svg>
      );
    case "radar":
      return (
        <div
          className="absolute inset-[2px] overflow-hidden rounded-full border"
          style={{ borderColor: `${glow}66` }}
        >
          <div
            className="animate-spin-slow absolute inset-0"
            style={{ background: `conic-gradient(${glow}aa, transparent 30%)` }}
          />
        </div>
      );
    case "server":
      return (
        <div className="absolute inset-x-1 bottom-0 top-0 flex items-end overflow-hidden">
          <div
            className="animate-server-pulse h-1 w-full rounded-full"
            style={{ background: glow }}
          />
        </div>
      );
    case "code":
      return (
        <div className="absolute inset-1 flex flex-col justify-center gap-[2px]">
          {[80, 55, 65, 40].map((w, i) => (
            <div
              key={i}
              className="h-[2px] rounded-full"
              style={{ width: `${w}%`, background: glow, opacity: 0.6 }}
            />
          ))}
        </div>
      );
    case "ui":
      return (
        <div className="absolute inset-1 grid grid-cols-2 gap-[2px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-[1px]"
              style={{ background: glow, opacity: 0.3 + (i % 2) * 0.3 }}
            />
          ))}
        </div>
      );
    case "data":
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-3 rounded-full border" style={{ borderColor: glow }} />
        </div>
      );
    case "checklist":
      return (
        <div className="absolute inset-1 flex flex-col justify-center gap-[3px]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-[2px]">
              <span
                className="h-[3px] w-[3px] shrink-0 rounded-[1px]"
                style={{ background: glow }}
              />
              <span
                className="h-[2px] flex-1 rounded-full"
                style={{ background: glow, opacity: 0.4 }}
              />
            </div>
          ))}
        </div>
      );
    case "neural":
      return (
        <div
          className="animate-node-pulse absolute inset-0"
          style={{ background: `radial-gradient(circle, ${glow}66, transparent 70%)` }}
        />
      );
    case "nodes":
      return (
        <svg viewBox="0 0 30 20" className="absolute inset-0 h-full w-full">
          <line x1="6" y1="6" x2="15" y2="15" stroke={glow} strokeWidth={0.6} opacity={0.5} />
          <line x1="24" y1="6" x2="15" y2="15" stroke={glow} strokeWidth={0.6} opacity={0.5} />
          <circle cx="6" cy="6" r="2" fill={glow} className="animate-node-pulse" />
          <circle
            cx="24"
            cy="6"
            r="2"
            fill={glow}
            className="animate-node-pulse"
            style={{ animationDelay: "0.6s" }}
          />
          <circle
            cx="15"
            cy="15"
            r="2"
            fill={glow}
            className="animate-node-pulse"
            style={{ animationDelay: "1.2s" }}
          />
        </svg>
      );
    case "board":
    case "doc":
    default:
      return (
        <div className="absolute inset-1 flex flex-col justify-center gap-[2px]">
          {[70, 45, 60].map((w, i) => (
            <div
              key={i}
              className="h-[2px] rounded-full"
              style={{ width: `${w}%`, background: glow, opacity: 0.5 }}
            />
          ))}
        </div>
      );
  }
}

/**
 * A real isometric desk+monitor(s)+chair tile from the asset pack (see
 * office-assets.ts), tiered by monitor count. A small CSS overlay — the
 * agent's role glyph plus a role-appropriate motion motif — sits over the
 * tile's screen area; that's the only part that's still CSS, since the
 * asset pack draws one fixed monitor arrangement per tile rather than a
 * data-aware one. No CSS fallback desk — every desk is real asset art.
 */
export function TradingDesk({
  left,
  top,
  monitors = 1,
  accent = "#22c55e",
  Icon,
  errored = false,
  kind = "chart",
  size = 100,
  className = "",
}: {
  left: number;
  top: number;
  monitors?: number;
  accent?: string;
  Icon?: LucideIcon;
  errored?: boolean;
  kind?: DeskKind;
  size?: number;
  className?: string;
}) {
  const glow = errored ? "#ef4444" : accent;
  const tier = (monitors >= 3 ? 3 : monitors >= 2 ? 2 : 1) as 1 | 2 | 3;
  const spec = DESK_TILE_BY_MONITOR_COUNT[tier];

  return (
    <div className={`absolute ${className}`} style={{ left, top, width: size, height: size }}>
      <OfficeAsset src={OFFICE_TILES[spec.tile]} alt="Desk workstation" width={size} height={size} />
      {/* screen glow + role motif, positioned over the tile's monitor area */}
      <div
        className="animate-monitor-flicker absolute overflow-hidden rounded-[1px]"
        style={{
          left: `${spec.screen.left}%`,
          top: `${spec.screen.top}%`,
          width: `${spec.screen.width}%`,
          height: `${spec.screen.height}%`,
          background: `${glow}26`,
          boxShadow: `0 0 4px ${glow}aa`,
        }}
      >
        {Icon ? (
          <Icon
            className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2"
            style={{ color: glow }}
            strokeWidth={2.5}
          />
        ) : (
          <ScreenMotif kind={kind} glow={glow} />
        )}
      </div>
    </div>
  );
}
