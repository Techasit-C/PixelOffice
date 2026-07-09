import { Row } from "./Row";
import { signColor } from "@/lib/utils";
import { MockRibbon } from "@/components/ui/MockRibbon";
import type { GridBotData } from "@/lib/mock-data";

export function GridBotWidget({
  data,
  mock = false,
}: {
  data: GridBotData;
  mock?: boolean;
}) {
  return (
    <div>
      {mock ? <MockRibbon>DEMO — ไม่ใช่ข้อมูลจริง (mock / ui-only)</MockRibbon> : null}
      <Row
        label="ROI"
        value={`${data.roiPercent.toFixed(2)}%`}
        valueClassName={signColor(data.roiPercent)}
      />
      <Row
        label="กำไรรวม"
        value={`$${data.totalProfit.toFixed(2)}`}
        valueClassName={signColor(data.totalProfit)}
      />
      <Row
        label="Grid Profit"
        value={`$${data.gridProfit.toFixed(2)}`}
        valueClassName={signColor(data.gridProfit)}
      />
      <Row label="ช่วงราคา" value={`${data.rangeLow} - ${data.rangeHigh}`} />
      <div className="flex items-center justify-between py-1.5 text-xs">
        <span className="text-muted-foreground">สถานะ</span>
        <span className="rounded-full border border-success/40 bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
          {data.status}
        </span>
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground">
        {data.source} · {data.updatedAt}
      </div>
    </div>
  );
}
