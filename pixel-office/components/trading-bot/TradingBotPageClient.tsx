"use client";

import { useState } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { PixelCard, StatLine } from "@/components/ui/PixelCard";
import { useJsonPoll } from "@/lib/use-json-poll";

interface TradingSignalDTO {
  symbol: string;
  timeframe: string;
  direction: "LONG" | "SHORT" | "WAIT";
  generatedAt: string;
  confidence: number;
  plainLanguageSummary?: string;
  macd?: { macdLine: number | null; signalLine: number | null; histogram: number | null };
  bollinger?: { middle: number | null; upper: number | null; lower: number | null; percentB: number | null };
  timeframeConfirmation?: {
    oneHour: "ALIGNED" | "NEUTRAL" | "UNAVAILABLE" | "OPPOSITE";
    oneDay: "ALIGNED" | "NEUTRAL" | "UNAVAILABLE" | "OPPOSITE";
    adjustment: number;
  } | null;
}
interface SignalsResponse {
  signals: TradingSignalDTO[];
  generatedAt: string;
}
interface PositionDTO {
  symbol: string;
  quantity: string;
  avgEntryPrice: string;
  marketValue: string | null;
  unrealizedPnl: string | null;
  realizedPnl: string;
}
interface AccountDTO {
  currency: string;
  cashBalance: string;
  equity: string;
  startingBalance: string;
  positions: PositionDTO[];
  generatedAt: string;
}
interface OrderResultDTO {
  orderId: string;
  status: "FILLED" | "REJECTED";
  reasonCode: string | null;
  reason: string | null;
  side: "BUY" | "SELL";
  symbol: string;
  requestedQuantity: string;
  fillPrice: string | null;
  fee: string | null;
  notional: string | null;
  realizedPnl: string | null;
  executedAt: string | null;
  idempotent: boolean;
}

export default function TradingBotPageClient() {
  const signals = useJsonPoll<SignalsResponse>("/api/trading-signals", 30_000);
  const account = useJsonPoll<AccountDTO>("/api/trading-bot/account", 15_000);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [closeQuantities, setCloseQuantities] = useState<Record<string, string>>({});
  const [pendingKeys, setPendingKeys] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] = useState<OrderResultDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function clearPendingKey(key: string) {
    setPendingKeys((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function placeOrder(signal: TradingSignalDTO) {
    const key = `order:${signal.symbol}`;
    const idempotencyKey = pendingKeys[key] ?? crypto.randomUUID();
    setPendingKeys((prev) => ({ ...prev, [key]: idempotencyKey }));
    setBusy(key);
    try {
      const res = await fetch("/api/trading-bot/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signalId: `${signal.symbol}:${signal.timeframe}`,
          observedGeneratedAt: signal.generatedAt,
          requestedQuantity: quantities[signal.symbol] || "0",
          idempotencyKey,
        }),
      });
      const json = (await res.json()) as OrderResultDTO;
      setLastResult(json);
      if (res.ok) clearPendingKey(key);
      account.refetch();
    } finally {
      setBusy(null);
    }
  }

  async function closePosition(position: PositionDTO) {
    const key = `close:${position.symbol}`;
    const idempotencyKey = pendingKeys[key] ?? crypto.randomUUID();
    setPendingKeys((prev) => ({ ...prev, [key]: idempotencyKey }));
    setBusy(key);
    try {
      const res = await fetch("/api/trading-bot/positions/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: position.symbol,
          requestedQuantity: closeQuantities[position.symbol] || position.quantity,
          idempotencyKey,
        }),
      });
      const json = (await res.json()) as OrderResultDTO;
      setLastResult(json);
      if (res.ok) clearPendingKey(key);
      account.refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell accent="#f59e0b">
      <PixelCard title="Trading Bot — Paper / Simulated" accent="#f59e0b">
        <p className="text-xs text-warning">
          Paper trading only — no real orders, no real money. This mode cannot be turned off.
          Account state is in-memory and resets whenever the server restarts (no persistence in Phase 1).
        </p>
      </PixelCard>

      <PixelCard title="Mock Account" accent="#f59e0b">
        {account.error ? (
          <p className="text-xs text-danger">Failed to load account: {account.error}</p>
        ) : account.data ? (
          <>
            <StatLine label="Cash (USDT)" value={account.data.cashBalance} />
            <StatLine label="Equity (USDT)" value={account.data.equity} />
            <StatLine label="Starting balance (USDT)" value={account.data.startingBalance} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Loading account…</p>
        )}
      </PixelCard>

      <PixelCard title="Open Positions" accent="#f59e0b">
        {account.data && account.data.positions.length > 0 ? (
          account.data.positions.map((p) => (
            <div key={p.symbol} className="border-t border-border/40 py-2 first:border-t-0">
              <StatLine label={p.symbol} value={`${p.quantity} @ ${p.avgEntryPrice}`} />
              <StatLine label="Realized P&L" value={p.realizedPnl} />
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label={`Close quantity for ${p.symbol}`}
                  className="w-32 rounded-sm border border-border bg-background px-2 py-1 text-xs"
                  value={closeQuantities[p.symbol] ?? p.quantity}
                  onChange={(e) =>
                    setCloseQuantities((q) => ({ ...q, [p.symbol]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  disabled={busy === `close:${p.symbol}`}
                  onClick={() => closePosition(p)}
                  className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No open positions.</p>
        )}
      </PixelCard>

      <PixelCard title="Signals" accent="#f59e0b">
        {signals.error ? (
          <p className="text-xs text-danger">Failed to load signals: {signals.error}</p>
        ) : null}
        {signals.data?.signals.map((s) => (
          <div key={s.symbol} className="border-t border-border/40 py-2 first:border-t-0">
            <StatLine label={s.symbol} value={`${s.direction} · confidence (heuristic) ${s.confidence}`} />
            {s.plainLanguageSummary ? (
              <p className="mt-1 text-[11px] text-muted-foreground">{s.plainLanguageSummary}</p>
            ) : null}
            {s.timeframeConfirmation ? (
              <p className="mt-1 text-[10px] text-muted-foreground/70">
                Timeframe confirmation: 1h {s.timeframeConfirmation.oneHour.toLowerCase()}, 1d{" "}
                {s.timeframeConfirmation.oneDay.toLowerCase()} ({s.timeframeConfirmation.adjustment >= 0 ? "+" : ""}
                {s.timeframeConfirmation.adjustment})
              </p>
            ) : null}
            {s.direction === "LONG" ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label={`Quantity for ${s.symbol}`}
                  placeholder="quantity"
                  className="w-32 rounded-sm border border-border bg-background px-2 py-1 text-xs"
                  value={quantities[s.symbol] ?? ""}
                  onChange={(e) => setQuantities((q) => ({ ...q, [s.symbol]: e.target.value }))}
                />
                <button
                  type="button"
                  disabled={busy === `order:${s.symbol}`}
                  onClick={() => placeOrder(s)}
                  className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
                >
                  Place Mock Order
                </button>
              </div>
            ) : s.direction === "SHORT" ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                SHORT not supported in Phase 1
              </p>
            ) : null}
          </div>
        ))}
        {!signals.data && !signals.error ? (
          <p className="text-xs text-muted-foreground">Loading signals…</p>
        ) : null}
      </PixelCard>

      {lastResult ? (
        <PixelCard title="Last Order Result" accent="#f59e0b">
          <StatLine label="Status" value={lastResult.status} />
          {lastResult.reason ? <StatLine label="Reason" value={lastResult.reason} /> : null}
        </PixelCard>
      ) : null}
    </PageShell>
  );
}
