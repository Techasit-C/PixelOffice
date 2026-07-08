import { Row } from "./Row";
import { signColor } from "@/lib/utils";
import { MockRibbon } from "@/components/ui/MockRibbon";
import type { TradingData } from "@/lib/mock-data";

export function TradingWidget({
  data,
  mock = false,
}: {
  data: TradingData;
  mock?: boolean;
}) {
  return (
    <div>
      {mock ? <MockRibbon>DEMO — ไม่ใช่ข้อมูลจริง (mock / ui-only)</MockRibbon> : null}
      <Row
        label="PnL วันนี้"
        value={`$${data.pnlToday.toFixed(2)}`}
        valueClassName={signColor(data.pnlToday)}
      />
      <Row
        label="Realized"
        value={`$${data.realized.toFixed(2)}`}
        valueClassName={signColor(data.realized)}
      />
      <Row label="Floating" value={`$${data.floating.toFixed(2)}`} />
      <Row
        label="W / L วันนี้"
        value={`${data.wins}W / ${data.losses}L · ${
          data.wins + data.losses > 0
            ? Math.round((data.wins / (data.wins + data.losses)) * 100)
            : 0
        }%`}
      />
      <div className="mt-2 border-t border-border/60 pt-2 text-xs">
        <div className="mb-1 text-muted-foreground">
          OPEN POSITIONS ({data.openPositions})
        </div>
        {data.openPositions === 0 ? (
          <div className="text-[10px] text-muted-foreground">
            ไม่มี position เปิดอยู่
          </div>
        ) : null}
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground">
        {data.version} · magic {data.magicNumber} · {data.updatedAt}
      </div>
    </div>
  );
}
