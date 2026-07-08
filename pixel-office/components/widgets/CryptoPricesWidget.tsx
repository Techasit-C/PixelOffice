import { cn, formatCompactCurrency } from "@/lib/utils";
import type { Quote } from "@/types/market";

function formatPrice(price: number) {
  if (price >= 100)
    return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

export function CryptoPricesWidget({
  quotes,
  source,
}: {
  quotes: Quote[];
  source?: "coingecko" | "mock";
}) {
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 pb-1 text-[10px] text-muted-foreground">
        <span>
          เหรียญ
          {source ? (
            <span
              className={cn(
                "ml-1.5 rounded-sm px-1",
                source === "coingecko"
                  ? "bg-success/15 text-success"
                  : "bg-white/5 text-muted-foreground/70",
              )}
            >
              {source === "coingecko" ? "live" : "mock"}
            </span>
          ) : null}
        </span>
        <span className="text-right">ราคา</span>
        <span className="text-right">24ชม</span>
      </div>
      <div className="max-h-64 overflow-y-auto scrollbar-thin">
        {quotes.map((q) => (
          <div
            key={q.symbol}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-t border-border/40 py-1.5 text-xs"
          >
            <div className="min-w-0">
              <div className="truncate font-semibold">{q.symbol}</div>
              <div className="truncate text-[10px] text-muted-foreground">
                {formatCompactCurrency(q.marketCap)}
              </div>
            </div>
            <span className="text-right tabular-nums">
              ${formatPrice(q.price)}
            </span>
            <span
              className={cn(
                "text-right tabular-nums",
                q.changePercent >= 0 ? "text-success" : "text-danger",
              )}
            >
              {q.changePercent >= 0 ? "+" : ""}
              {q.changePercent.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
