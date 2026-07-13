import type { LucideIcon } from "lucide-react";

const MONITOR_W = 30;
const GAP = 4;

function deskWidth(monitors: number): number {
  return monitors * MONITOR_W + (monitors - 1) * GAP;
}

/**
 * A Bloomberg-style multi-monitor desk. The first screen shows the agent's
 * role glyph; any additional screens show a small decorative bar-chart glow.
 * Pure presentation — no live data is implied by the chart shape.
 */
export function TradingDesk({
  left,
  top,
  monitors = 1,
  accent = "#22c55e",
  Icon,
  errored = false,
}: {
  left: number;
  top: number;
  monitors?: number;
  accent?: string;
  Icon?: LucideIcon;
  errored?: boolean;
}) {
  const glow = errored ? "#ef4444" : accent;
  const width = deskWidth(monitors);

  return (
    <div className="absolute" style={{ left, top }}>
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
              <div className="absolute inset-x-1 bottom-1 flex items-end gap-[1px]">
                {[3, 6, 4, 7, 5].map((h, bi) => (
                  <div
                    key={bi}
                    className="w-[3px] rounded-t-[1px]"
                    style={{ height: h, background: glow, opacity: 0.65 }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 h-2 rounded-sm bg-[#1c2430]" style={{ width }} />
      <div className="h-7 rounded-b-sm bg-[#141a22]" style={{ width }} />
    </div>
  );
}
