"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  AreaData,
  IChartApi,
  ISeriesApi,
  LineData,
  UTCTimestamp,
} from "lightweight-charts";
import { usePerformance } from "@/lib/portfolio-client/hooks";
import { formatThb } from "@/lib/portfolio-client/format";
import type { PerformanceEnvelope, SeriesPoint } from "@/lib/portfolio-client/types";
import { EmptyBlock, ErrorBlock, LoadingBlock, SourceBadge } from "./ui";

/**
 * Portfolio value-over-time chart backed by the real snapshot series
 * (`GET /api/portfolios/[id]/performance`). Renders a TradingView Lightweight
 * Charts area series of the THB total value, with the cost basis overlaid as a
 * muted line for context.
 *
 * Client-only by construction: the charting library is loaded via a dynamic
 * `import()` INSIDE a layout effect, so its DOM/`window`-touching code never runs
 * during SSR (only type-only imports are evaluated at module scope). History is
 * captured by a daily snapshot job, so a fresh portfolio legitimately has an
 * EMPTY series — that is a friendly empty state, not an error.
 */
export function PerformanceChart({ portfolioId }: { portfolioId: string | undefined }) {
  const { data, error, loading, refetch } = usePerformance(portfolioId);

  if (loading) {
    return <LoadingBlock rows={4} label="กำลังโหลดประวัติมูลค่าพอร์ต…" />;
  }
  if (error) {
    return <ErrorBlock error={error} onRetry={refetch} />;
  }
  if (!data || data.series.length === 0) {
    return (
      <EmptyBlock
        title="ยังไม่มีประวัติมูลค่าพอร์ต"
        hint="กราฟจะค่อย ๆ มีข้อมูลเมื่อระบบบันทึกมูลค่าพอร์ตเป็นสแนปช็อตรายวัน — พอร์ตที่เพิ่งสร้างจึงยังว่างอยู่ กลับมาดูใหม่ในวันถัดไป"
      />
    );
  }

  return <PerformanceChartCanvas data={data} />;
}

/** Parse an API decimal STRING to a finite number ONLY at the render boundary. */
function toPoints<T extends AreaData<UTCTimestamp> | LineData<UTCTimestamp>>(
  points: SeriesPoint[],
): T[] {
  const out: T[] = [];
  for (const p of points) {
    const value = Number(p.value);
    if (!Number.isFinite(value)) continue;
    out.push({ time: p.time as UTCTimestamp, value } as T);
  }
  return out;
}

const VALUE_COLOR = "#22d3ee"; // matches the panel accent
const COST_COLOR = "rgba(148,163,184,0.55)";

function PerformanceChartCanvas({ data }: { data: PerformanceEnvelope }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const valueData = useMemo(
    () => toPoints<AreaData<UTCTimestamp>>(data.series),
    [data.series],
  );
  const costData = useMemo(
    () => toPoints<LineData<UTCTimestamp>>(data.costSeries ?? []),
    [data.costSeries],
  );

  const latest = data.series[data.series.length - 1];
  const ariaLabel = `กราฟมูลค่าพอร์ตย้อนหลัง ${data.series.length} จุดข้อมูล ล่าสุด ${
    latest ? formatThb(latest.value) : "—"
  }`;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let chart: IChartApi | null = null;

    void (async () => {
      // Load the charting lib on the client only — never during SSR.
      const lib = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      chart = lib.createChart(containerRef.current, {
        autoSize: true, // observes the container → responsive width/height
        layout: {
          background: { type: lib.ColorType.Solid, color: "transparent" },
          textColor: "#94a3b8",
          fontSize: 10,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.04)" },
          horzLines: { color: "rgba(255,255,255,0.04)" },
        },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
        timeScale: {
          borderColor: "rgba(255,255,255,0.08)",
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        crosshair: { mode: lib.CrosshairMode.Magnet },
        localization: {
          priceFormatter: (p: number) => `฿${Math.round(p).toLocaleString("en-US")}`,
        },
      });

      const area: ISeriesApi<"Area"> = chart.addSeries(lib.AreaSeries, {
        lineColor: VALUE_COLOR,
        topColor: "rgba(34,211,238,0.28)",
        bottomColor: "rgba(34,211,238,0.02)",
        lineWidth: 2,
        priceLineVisible: false,
      });
      area.setData(valueData);

      // Cost-basis overlay for context — only when clean data exists.
      if (costData.length > 0) {
        const cost: ISeriesApi<"Line"> = chart.addSeries(lib.LineSeries, {
          color: COST_COLOR,
          lineWidth: 1,
          lineStyle: lib.LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        cost.setData(costData);
      }

      chart.timeScale().fitContent();
    })();

    // Dispose the chart on unmount / data change — no leaks, no orphan canvases.
    return () => {
      disposed = true;
      chart?.remove();
      chart = null;
    };
  }, [valueData, costData]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: VALUE_COLOR }}
              aria-hidden
            />
            มูลค่าพอร์ต
          </span>
          {costData.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-px w-3"
                style={{ background: COST_COLOR }}
                aria-hidden
              />
              ต้นทุน
            </span>
          ) : null}
        </div>
        <SourceBadge source={data.source} />
      </div>
      <div
        ref={containerRef}
        role="img"
        aria-label={ariaLabel}
        className="h-[260px] w-full"
      />
    </div>
  );
}
