"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { formatThb, clampPct } from "@/lib/portfolio-client/format";
import type { AllocationSliceDTO } from "@/lib/portfolio-client/types";

// Hand-rolled SVG donut — zero dependency, fits the pixel aesthetic. `pct` values
// come numeric from the API; we only lay out arcs (no money math on strings).
const PALETTE = [
  "#3b82f6",
  "#22d3ee",
  "#a78bfa",
  "#f2c14e",
  "#22c55e",
  "#ec4899",
  "#f97316",
  "#14b8a6",
];

const R = 60;
const STROKE = 22;
const C = 2 * Math.PI * R;

export function AllocationDonut({ slices }: { slices: AllocationSliceDTO[] }) {
  const titleId = useId();
  const ordered = [...slices].sort((a, b) => b.pct - a.pct);

  let offset = 0;
  const arcs = ordered.map((s, i) => {
    const pct = clampPct(s.pct);
    const len = (pct / 100) * C;
    const arc = {
      color: PALETTE[i % PALETTE.length],
      dash: len,
      gap: C - len,
      rotation: (offset / 100) * 360,
    };
    offset += pct;
    return arc;
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg
        viewBox="0 0 160 160"
        className="h-40 w-40 shrink-0 -rotate-90"
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>สัดส่วนการจัดสรรสินทรัพย์</title>
        <circle
          cx="80"
          cy="80"
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={STROKE}
        />
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx="80"
            cy="80"
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth={STROKE}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={-((a.rotation / 360) * C)}
            style={{ transition: "stroke-dasharray 400ms" }}
          />
        ))}
      </svg>

      <ul className="w-full space-y-1">
        {ordered.map((s, i) => (
          <li
            key={s.key}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
              />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 tabular-nums">
              <span className="text-muted-foreground">{formatThb(s.marketValueBase)}</span>
              <span className={cn("w-12 text-right font-medium")}>
                {clampPct(s.pct).toFixed(1)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
