import { Row } from "./Row";
import type { AffiliateData } from "@/lib/mock-data";

export function AffiliateWidget({ data }: { data: AffiliateData }) {
  return (
    <div>
      <div className="mb-2">
        <div className="font-pixel text-lg text-warning">
          ฿{data.todayThb.toFixed(2)}
        </div>
        <div className="text-sm text-muted-foreground">
          ${data.todayUsd.toFixed(2)} <span className="text-[10px]">USDT</span>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          @ {data.fxRate.toFixed(2)} THB/USD · {data.fxSource}
        </div>
      </div>
      <div className="border-t border-border/60 pt-1">
        <Row label="Bybit pending" value={`$${data.bybitPending.toFixed(2)}`} />
        <Row label="Bitget วันนี้" value={`$${data.bitgetToday.toFixed(2)}`} />
        <Row label="MEXC วันนี้" value={`$${data.mexcToday.toFixed(2)}`} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>อัปเดต {data.updatedAt}</span>
        {data.source === "mock" ? (
          <span className="rounded-sm bg-white/5 px-1 text-muted-foreground/70">
            mock
          </span>
        ) : data.source === "live" ? (
          <span className="rounded-sm bg-success/15 px-1 text-success">
            live
          </span>
        ) : null}
      </div>
    </div>
  );
}
