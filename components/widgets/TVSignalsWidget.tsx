import { cn } from "@/lib/utils";
import type { TVAlert } from "@/lib/tradingview-alerts";

export function TVSignalsWidget({ alerts }: { alerts: TVAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground">
        ยังไม่มี alert เข้ามา — ตั้งค่า TradingView alert ให้ยิง webhook มาที่
        /api/tradingview-webhook (ต้อง deploy หรือ tunnel ให้เข้าถึงจากอินเทอร์เน็ตได้ก่อน)
      </div>
    );
  }

  return (
    <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto scrollbar-thin">
      {alerts.map((a) => (
        <div
          key={a.id}
          className="rounded-sm border border-border/40 px-2 py-1 text-xs"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold">{a.symbol ?? "alert"}</span>
            <span
              className={cn(
                "text-[10px] font-semibold uppercase",
                a.action === "buy"
                  ? "text-success"
                  : a.action === "sell"
                    ? "text-danger"
                    : "text-muted-foreground",
              )}
            >
              {a.action ?? "—"}
            </span>
          </div>
          {a.price !== undefined ? (
            <div className="text-[10px] text-muted-foreground">@ {a.price}</div>
          ) : null}
          <div className="text-[10px] text-muted-foreground">
            {a.strategy ? `${a.strategy} · ` : ""}
            {a.receivedAt}
          </div>
        </div>
      ))}
    </div>
  );
}
