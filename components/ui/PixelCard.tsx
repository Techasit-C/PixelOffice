import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Static pixel-chrome card — mirrors WidgetWindow's border/gradient/clip aesthetic
 * (see components/widgets/WidgetWindow.tsx and components/portfolio/ui.tsx `Panel`)
 * but WITHOUT drag / absolute positioning, so it can live inside a responsive grid.
 * Headings use the shared `--font-pixel` token via `.font-pixel`.
 */
export function PixelCard({
  title,
  accent = "#3b82f6",
  right,
  className,
  bodyClassName,
  children,
}: {
  title?: string;
  accent?: string;
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-md border shadow-[0_8px_30px_rgba(0,0,0,0.45)]",
        className,
      )}
      style={{
        borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
        background:
          "linear-gradient(180deg, rgba(15,18,32,0.97), rgba(10,12,22,0.97))",
        clipPath:
          "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
      }}
    >
      {title !== undefined ? (
        <header
          className="flex items-center justify-between gap-2 border-b px-3 py-2"
          style={{
            borderColor: `color-mix(in oklab, ${accent} 35%, transparent)`,
            background: `color-mix(in oklab, ${accent} 12%, transparent)`,
          }}
        >
          <h2
            className="truncate font-pixel text-[10px] leading-none tracking-wide"
            style={{ color: accent }}
          >
            {title}
          </h2>
          {right ? (
            <div className="flex shrink-0 items-center gap-2">{right}</div>
          ) : null}
        </header>
      ) : null}
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * Compact live/mock provenance tag — honesty marker so mock is never shown as real.
 * Accepts every `source`/`holdingsSource` shape the existing endpoints emit:
 * "live" | "partial" | "coingecko" (live) | "mock" | "empty" | "filesystem".
 */
export function SourceTag({ source }: { source?: string }) {
  if (!source) return null;
  const isLive = source === "live" || source === "coingecko" || source === "filesystem";
  const isPartial = source === "partial";
  const label =
    source === "coingecko" ? "live" : source === "filesystem" ? "live" : source;
  return (
    <span
      className={cn(
        "rounded-sm px-1 text-[10px] leading-4",
        isLive && "bg-success/15 text-success",
        isPartial && "bg-warning/15 text-warning",
        !isLive && !isPartial && "bg-white/5 text-muted-foreground/70",
      )}
      title={
        isLive
          ? "ข้อมูลสด (live)"
          : isPartial
            ? "บางส่วนสด บางส่วนสำรอง (partial)"
            : "ข้อมูลจำลอง (mock)"
      }
    >
      {label}
    </span>
  );
}

/** Small labelled KPI number used across the executive/mission views. */
export function StatLine({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border/40 py-1.5 text-xs first:border-t-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", valueClassName)}>{value}</span>
    </div>
  );
}
