"use client";

import { cn } from "@/lib/utils";
import {
  formatThb,
  formatNative,
  formatQuantity,
  formatPct,
  signClass,
  signClassNum,
} from "@/lib/portfolio-client/format";
import { SourceBadge } from "./ui";
import type { HoldingView } from "@/lib/portfolio-client/types";

/** Holdings table — responsive: table on md+, stacked cards on small screens. */
export function HoldingsTable({ holdings }: { holdings: HoldingView[] }) {
  return (
    <>
      {/* md+ : table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">รายการสินทรัพย์ที่ถือครอง</caption>
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-1.5 pr-3 font-medium">สินทรัพย์</th>
              <th scope="col" className="py-1.5 px-3 text-right font-medium">จำนวน</th>
              <th scope="col" className="py-1.5 px-3 text-right font-medium">ต้นทุน/หน่วย</th>
              <th scope="col" className="py-1.5 px-3 text-right font-medium">ราคาปัจจุบัน</th>
              <th scope="col" className="py-1.5 px-3 text-right font-medium">มูลค่า (฿)</th>
              <th scope="col" className="py-1.5 pl-3 text-right font-medium">กำไร/ขาดทุน</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.assetSymbol} className="border-t border-border/40">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{h.assetSymbol}</span>
                    <span className="rounded-sm bg-white/5 px-1 text-[9px] text-muted-foreground/80">
                      {h.assetClass}
                    </span>
                    <SourceBadge source={h.priceSource} />
                  </div>
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatQuantity(h.quantity)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatNative(h.avgCostPerUnit, "USD")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNative(h.currentPrice, "USD")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatThb(h.currentValueBase)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  <div className={signClass(h.unrealizedPnlBase)}>
                    {formatThb(h.unrealizedPnlBase, { sign: true })}
                  </div>
                  <div className={cn("text-[10px]", signClassNum(h.unrealizedPnlPct))}>
                    {formatPct(h.unrealizedPnlPct)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* small screens : stacked cards */}
      <ul className="space-y-2 md:hidden">
        {holdings.map((h) => (
          <li
            key={h.assetSymbol}
            className="rounded-sm border border-border/50 bg-white/[0.02] p-2.5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold">{h.assetSymbol}</span>
                <span className="rounded-sm bg-white/5 px-1 text-[9px] text-muted-foreground/80">
                  {h.assetClass}
                </span>
                <SourceBadge source={h.priceSource} />
              </div>
              <span className="font-semibold tabular-nums">
                {formatThb(h.currentValueBase)}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
              <span>จำนวน: <span className="tabular-nums text-foreground">{formatQuantity(h.quantity)}</span></span>
              <span className="text-right">ราคา: <span className="tabular-nums text-foreground">{formatNative(h.currentPrice, "USD")}</span></span>
              <span>ต้นทุน/หน่วย: <span className="tabular-nums text-foreground">{formatNative(h.avgCostPerUnit, "USD")}</span></span>
              <span className={cn("text-right tabular-nums", signClass(h.unrealizedPnlBase))}>
                {formatThb(h.unrealizedPnlBase, { sign: true })} ({formatPct(h.unrealizedPnlPct)})
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
