import { Row } from "./Row";
import { formatCompactCurrency, signColor } from "@/lib/utils";
import type { CompanyStatusData } from "@/lib/mock-data";

export function CompanyStatusWidget({ data }: { data: CompanyStatusData }) {
  return (
    <div>
      <Row
        label="Realized PnL"
        value={formatCompactCurrency(data.realizedPnl)}
        valueClassName={signColor(data.realizedPnl)}
      />
      <Row
        label="Total PnL"
        value={formatCompactCurrency(data.totalPnl)}
        valueClassName={signColor(data.totalPnl)}
      />
      <Row
        label="Net Cashflow"
        value={formatCompactCurrency(data.netCashflow)}
        valueClassName="text-success"
      />
      <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
        <span className="text-muted-foreground">Holdings</span>
        <span className="flex items-center gap-1.5">
          <span className="font-medium tabular-nums">
            {data.holdingsBtc.toFixed(4)} BTC · {data.holdingsUsdt.toLocaleString()} USDT
          </span>
          {data.holdingsSource === "live" ? (
            <span className="rounded-sm bg-success/15 px-1 text-[10px] text-success">
              live
            </span>
          ) : data.holdingsSource === "mock" ? (
            <span className="rounded-sm bg-white/5 px-1 text-[10px] text-muted-foreground/70">
              mock
            </span>
          ) : null}
        </span>
      </div>
      <Row label="APY" value={`${data.apy.toFixed(1)}%`} />
      <Row label="Safe Withdraw" value={`$${data.safeWithdraw}`} />
      <div className="mt-2 text-[10px] text-muted-foreground">
        อัปเดต {data.updatedAt}
      </div>
    </div>
  );
}
