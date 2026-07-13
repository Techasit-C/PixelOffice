import { cn } from "@/lib/utils";
import {
  WidgetGatedNotice,
  type WidgetGateReason,
} from "@/components/widgets/WidgetGatedNotice";

// Local type mirror of the read-only trading-signals contract. The canonical
// source is `@/lib/trading-signals/types` (built by the backend team); until
// that lands this widget stays self-contained so the build never breaks. If
// that module exists, QA reconciles by swapping these declarations for an
// import — the shapes are intentionally identical.
type Timeframe = "1h" | "4h" | "1d";
type SignalDirection = "LONG" | "SHORT" | "WAIT";
type SignalSource = "analysis" | "mock" | "insufficient-data";

interface PriceLevel {
  price: number;
  label: string;
}

export interface TradingSignal {
  symbol: string;
  timeframe: Timeframe;
  direction: SignalDirection;
  entryZone: { low: number; high: number } | null;
  stopLoss: number | null;
  takeProfit: PriceLevel[];
  riskRewardRatio: number | null;
  confidence: number; // 0..100
  reasoning: string[];
  invalidationCondition: string;
  generatedAt: string;
  source: SignalSource;
}

function formatPrice(price: number) {
  if (price >= 100)
    return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

function DirectionBadge({ direction }: { direction: SignalDirection }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        direction === "LONG"
          ? "bg-success/15 text-success"
          : direction === "SHORT"
            ? "bg-danger/15 text-danger"
            : "bg-white/5 text-muted-foreground",
      )}
    >
      {direction}
    </span>
  );
}

function SourceLabel({ source }: { source: SignalSource }) {
  const map: Record<SignalSource, { text: string; className: string }> = {
    analysis: { text: "Live/Analysis", className: "bg-success/15 text-success" },
    mock: { text: "Mock", className: "bg-white/5 text-muted-foreground/70" },
    "insufficient-data": {
      text: "Insufficient data",
      className: "bg-warning/15 text-warning",
    },
  };
  const { text, className } = map[source] ?? map.mock;
  return (
    <span
      className={cn(
        "rounded-sm px-1 text-[10px] font-medium uppercase tracking-wide",
        className,
      )}
    >
      {text}
    </span>
  );
}

function SignalCard({ signal }: { signal: TradingSignal }) {
  const {
    symbol,
    timeframe,
    direction,
    entryZone,
    stopLoss,
    takeProfit,
    riskRewardRatio,
    confidence,
    reasoning,
    invalidationCondition,
    generatedAt,
    source,
  } = signal;

  const tps = Array.isArray(takeProfit) ? takeProfit : [];
  const reasons = Array.isArray(reasoning) ? reasoning : [];

  return (
    <div className="rounded-sm border border-border/40 px-2 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <DirectionBadge direction={direction} />
          <span className="truncate font-semibold">{symbol}</span>
          <span className="text-[10px] text-muted-foreground">
            {timeframe}
          </span>
        </div>
        <SourceLabel source={source} />
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>ความมั่นใจ</span>
        <span className="tabular-nums text-foreground/80">
          {Math.round(confidence)}%
        </span>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entry</span>
          <span className="tabular-nums">
            {entryZone
              ? `${formatPrice(entryZone.low)}–${formatPrice(entryZone.high)}`
              : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Stop</span>
          <span className="tabular-nums text-danger/90">
            {stopLoss !== null ? formatPrice(stopLoss) : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">R:R</span>
          <span className="tabular-nums">
            {riskRewardRatio !== null ? `${riskRewardRatio.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">TP</span>
          <span className="tabular-nums text-success/90">
            {tps.length > 0 ? `${tps.length} lv` : "—"}
          </span>
        </div>
      </div>

      {tps.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {tps.map((tp, i) => (
            <span
              key={`${tp.label}-${i}`}
              className="rounded-sm bg-success/10 px-1 text-[10px] tabular-nums text-success/90"
            >
              {tp.label}: {formatPrice(tp.price)}
            </span>
          ))}
        </div>
      ) : null}

      {reasons.length > 0 ? (
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] text-muted-foreground">
          {reasons.map((r, i) => (
            <li key={i} className="marker:text-muted-foreground/50">
              {r}
            </li>
          ))}
        </ul>
      ) : null}

      {invalidationCondition ? (
        <div className="mt-1 text-[10px] text-muted-foreground/80">
          <span className="text-muted-foreground/60">Invalidation: </span>
          {invalidationCondition}
        </div>
      ) : null}

      <div className="mt-1 text-[10px] text-muted-foreground/60">
        {generatedAt}
      </div>
    </div>
  );
}

export function TradingSignalsWidget({
  signals,
  gateReason,
}: {
  signals: TradingSignal[];
  gateReason?: WidgetGateReason | null;
}) {
  if (gateReason) {
    return <WidgetGatedNotice reason={gateReason} />;
  }

  const list = Array.isArray(signals) ? signals : [];

  if (list.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground">
        ยังไม่มีสัญญาณ — ระบบวิเคราะห์จะแสดงสัญญาณ LONG/SHORT/WAIT ที่นี่เมื่อพร้อม
        (ข้อมูลอ่านอย่างเดียว ไม่ใช่คำแนะนำการลงทุน)
      </div>
    );
  }

  return (
    <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto scrollbar-thin">
      {list.map((s, i) => (
        <SignalCard key={`${s.symbol}-${s.timeframe}-${i}`} signal={s} />
      ))}
    </div>
  );
}
