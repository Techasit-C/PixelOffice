import type { LucideIcon } from "lucide-react";
import type { DeskKind } from "./role-visuals";

const MONITOR_W = 30;
const GAP = 4;

function deskWidth(monitors: number): number {
  return monitors * MONITOR_W + (monitors - 1) * GAP;
}

/** Small, purely decorative motion motif for a desk's secondary screens. */
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
          className="absolute inset-[3px] overflow-hidden rounded-full border"
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
 * A cozy pixel-HD desk: a warm wooden surface with a keyboard strip, a mug
 * and a notebook, topped by one or more monitors. The first screen shows the
 * agent's role glyph; any additional screens play a small role-appropriate
 * motion motif. Pure presentation — no live data is implied by any shape.
 */
export function TradingDesk({
  left,
  top,
  monitors = 1,
  accent = "#22c55e",
  Icon,
  errored = false,
  kind = "chart",
  className = "",
}: {
  left: number;
  top: number;
  monitors?: number;
  accent?: string;
  Icon?: LucideIcon;
  errored?: boolean;
  kind?: DeskKind;
  className?: string;
}) {
  const glow = errored ? "#ef4444" : accent;
  const width = deskWidth(monitors);

  return (
    <div className={`absolute ${className}`} style={{ left, top }}>
      <div className="flex" style={{ gap: GAP }}>
        {Array.from({ length: monitors }).map((_, i) => (
          <div
            key={i}
            className="animate-monitor-flicker relative h-10 overflow-hidden rounded-[2px] border border-black/70 bg-[#050b12]"
            style={{
              width: MONITOR_W,
              boxShadow: `0 0 6px ${glow}66 inset, 0 0 5px ${glow}40`,
              animationDelay: `${i * 0.7}s`,
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-[2px]"
              style={{ background: glow, opacity: 0.9 }}
            />
            {Icon && i === 0 ? (
              <Icon
                className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2"
                style={{ color: glow }}
                strokeWidth={2.25}
              />
            ) : (
              <ScreenMotif kind={kind} glow={glow} />
            )}
          </div>
        ))}
      </div>
      {/* keyboard strip */}
      <div
        className="mt-1 h-2 rounded-sm bg-[#2a1f16]"
        style={{ width, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.3)" }}
      />
      {/* wooden desk surface, with a mug + notebook for cozy flavor */}
      <div
        className="relative h-7 rounded-b-sm"
        style={{
          width,
          background: "linear-gradient(180deg, #6b4a2f, #4a3320)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        <span className="absolute bottom-1 left-0.5 h-1.5 w-1.5 rounded-full border border-black/30 bg-[#e5e7eb]/80" />
        <span className="absolute bottom-1 right-0.5 h-1.5 w-2 rounded-[1px] bg-[#93c5fd]/70" />
      </div>
    </div>
  );
}
