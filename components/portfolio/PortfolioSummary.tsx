"use client";

import { cn } from "@/lib/utils";
import {
  formatThb,
  formatUsd,
  formatPct,
  signClass,
  signClassNum,
} from "@/lib/portfolio-client/format";
import type { ValuationEnvelope } from "@/lib/portfolio-client/types";

/** Portfolio Summary: total value, cost basis, unrealized P&L in THB + USD. */
export function PortfolioSummary({ data }: { data: ValuationEnvelope }) {
  const t = data.totals;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="มูลค่าปัจจุบัน"
          primary={formatThb(t.marketValueBase)}
          secondary={formatUsd(t.marketValueUsd)}
        />
        <Stat
          label="ต้นทุน (Cost basis)"
          primary={formatThb(t.costBasisBase)}
          secondary={formatUsd(t.costBasisUsd)}
        />
        <Stat
          label="กำไร/ขาดทุน (THB)"
          primary={formatThb(t.unrealizedPnlBase, { sign: true })}
          primaryClassName={signClass(t.unrealizedPnlBase)}
          secondary={formatPct(t.unrealizedPnlPct)}
          secondaryClassName={signClassNum(t.unrealizedPnlPct)}
        />
        <Stat
          label="อัตราแลกเปลี่ยน"
          primary={`฿${Number(data.fxRate).toFixed(2)}/$`}
          secondary={`ณ ${new Date(data.asOf).toLocaleString("th-TH", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "short",
          })}`}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  primary,
  secondary,
  primaryClassName,
  secondaryClassName,
}: {
  label: string;
  primary: string;
  secondary?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
}) {
  return (
    <div className="rounded-sm border border-border/60 bg-white/[0.02] p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 text-base font-semibold tabular-nums", primaryClassName)}>
        {primary}
      </div>
      {secondary ? (
        <div className={cn("text-[11px] tabular-nums text-muted-foreground", secondaryClassName)}>
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
