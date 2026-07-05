"use client";

// Read-only dashboard widget for the pixel office: total portfolio value + DCA
// milestone bar. Self-fetching (uses the portfolio list summary) with graceful
// loading / empty / error states so it never breaks the office if the API 401s
// (which it does in dev without Clerk keys). Slots into PixelOfficePageClient's
// widget map as `portfolio`.
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortfolios } from "@/lib/portfolio-client/hooks";
import { formatThb, signClass, clampPct } from "@/lib/portfolio-client/format";
import { Row } from "./Row";

export function PortfolioWidget() {
  const { data, error, loading } = usePortfolios();
  const portfolios = data?.portfolios ?? [];
  // Aggregate value across portfolios is a backend concern; the summary endpoint
  // returns per-portfolio figures, so show the primary (first) portfolio here and
  // link out to the full surface for the rest.
  const primary = portfolios[0];

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        กำลังโหลดพอร์ต…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />
          โหลดพอร์ตไม่ได้
        </div>
        <p className="text-[10px] text-muted-foreground/70">{error.message}</p>
        <PortfolioLink />
      </div>
    );
  }

  if (!primary) {
    return (
      <div className="space-y-2">
        <p className="py-1 text-[11px] text-muted-foreground">ยังไม่มีพอร์ต</p>
        <PortfolioLink label="สร้างพอร์ตแรก" />
      </div>
    );
  }

  const pct = clampPct(primary.dcaPct);

  return (
    <div>
      <div className="mb-1 truncate text-[11px] text-muted-foreground">
        {primary.name}
      </div>
      <div className="text-lg font-semibold tabular-nums">
        {formatThb(primary.currentValueBase)}
      </div>

      <Row
        label="กำไร/ขาดทุน"
        value={formatThb(primary.unrealizedPnlBase, { sign: true })}
        valueClassName={signClass(primary.unrealizedPnlBase)}
      />

      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>DCA สู่ {formatThb(primary.dcaTargetAmount)}</span>
          <span className="tabular-nums">{pct.toFixed(1)}%</span>
        </div>
        <div
          className="h-2.5 overflow-hidden rounded-sm bg-white/5"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="ความคืบหน้า DCA"
        >
          <div
            className="h-full rounded-sm bg-gradient-to-r from-success/60 to-success transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {portfolios.length > 1 ? (
        <div className="mt-2 text-[10px] text-muted-foreground/70">
          +{portfolios.length - 1} พอร์ตอื่น
        </div>
      ) : null}

      <div className="mt-2">
        <PortfolioLink />
      </div>
    </div>
  );
}

function PortfolioLink({ label = "เปิดหน้าจัดการพอร์ต" }: { label?: string }) {
  return (
    <Link
      href="/portfolio"
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[10px] text-foreground",
        "hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      )}
    >
      {label}
      <ArrowUpRight className="h-3 w-3" aria-hidden />
    </Link>
  );
}
