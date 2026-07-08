"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { clampPct, formatThb } from "@/lib/portfolio-client/format";
import type { MilestonesEnvelope } from "@/lib/portfolio-client/types";

/**
 * DCA milestone progress toward ฿1,000,000. Pure presentational — takes the
 * already-computed MilestoneSummary; percentages come numeric from the API.
 */
export function MilestoneProgress({
  data,
  compact = false,
  accent = "#22c55e",
}: {
  data: Pick<MilestonesEnvelope, "target" | "currentValueBase" | "pct" | "milestones">;
  compact?: boolean;
  accent?: string;
}) {
  const pct = clampPct(data.pct);

  return (
    <div>
      <div className="mb-1 flex items-end justify-between gap-2">
        <span className="text-xs font-medium tabular-nums">
          {formatThb(data.currentValueBase)}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          เป้า {formatThb(data.target)} · {pct.toFixed(1)}%
        </span>
      </div>

      <div
        className="relative h-3 overflow-hidden rounded-sm bg-white/5"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`ความคืบหน้า DCA สู่ ${formatThb(data.target)}`}
      >
        <div
          className="h-full rounded-sm transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, color-mix(in oklab, ${accent} 55%, transparent), ${accent})`,
          }}
        />
        {/* milestone checkpoint ticks */}
        {!compact &&
          data.milestones.map((m, i) => {
            const denomTop = data.milestones[data.milestones.length - 1];
            const at = markerPct(m.targetAmount, denomTop?.targetAmount);
            return (
              <span
                key={i}
                className="absolute top-0 h-full w-px bg-black/40"
                style={{ left: `${at}%` }}
                aria-hidden
              />
            );
          })}
      </div>

      {!compact ? (
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
          {data.milestones.map((m, i) => (
            <li
              key={i}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <span
                className={cn(
                  "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border",
                  m.reached
                    ? "border-success bg-success/20 text-success"
                    : "border-border text-transparent",
                )}
                aria-hidden
              >
                <Check className="h-2.5 w-2.5" />
              </span>
              <span className={cn("tabular-nums", m.reached && "text-foreground")}>
                {formatThb(m.targetAmount)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Position a checkpoint tick as a fraction of the top target (display only). */
function markerPct(target: string, top: string | undefined): number {
  const t = Number(target);
  const cap = Number(top);
  if (!Number.isFinite(t) || !Number.isFinite(cap) || cap <= 0) return 0;
  return clampPct((t / cap) * 100);
}
