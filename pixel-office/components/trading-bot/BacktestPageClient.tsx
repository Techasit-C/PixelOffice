"use client";

import { useRef, useState } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { PixelCard, StatLine } from "@/components/ui/PixelCard";
import { tradeLedgerToCsv } from "@/lib/backtest/csv";
import { SUPPORTED_SYMBOLS } from "@/lib/trading-signals/config";
import type { BacktestResult, TradeLedgerEntry } from "@/lib/backtest/types";

type Status = "idle" | "validating" | "running" | "done" | "error" | "cancelled";

function EquitySparkline({ points }: { points: { time: number; equity: string }[] }) {
  if (points.length < 2) return null;
  const values = points.map((p) => Number(p.equity));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 600;
  const height = 80;
  const path = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = max === min ? height / 2 : height - ((v - min) / (max - min)) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      role="img"
      aria-label={`Equity curve from ${values[0]!.toFixed(2)} to ${values[values.length - 1]!.toFixed(2)}`}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
    >
      <path d={path} fill="none" stroke="#f59e0b" strokeWidth={2} />
    </svg>
  );
}

function downloadCsv(entries: TradeLedgerEntry[], symbol: string) {
  const csv = tradeLedgerToCsv(entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backtest-${symbol.replace("/", "-")}-trade-ledger.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BacktestPageClient() {
  const [symbol, setSymbol] = useState(SUPPORTED_SYMBOLS[0]!);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [initialBalance, setInitialBalance] = useState("10000");
  const [feeRate, setFeeRate] = useState("0.001");
  const [spreadBps, setSpreadBps] = useState("5");
  const [slippageBps, setSlippageBps] = useState("5");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function run() {
    setStatus("validating");
    setError(null);
    const requestedStart = new Date(start).getTime();
    const requestedEnd = new Date(end).getTime();
    if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd) || requestedEnd <= requestedStart) {
      setStatus("error");
      setError("Enter a valid start and end date, with end after start.");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("running");
    try {
      const res = await fetch("/api/trading-bot/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          symbol,
          requestedStart,
          requestedEnd,
          initialBalance: Number(initialBalance),
          feeRate: Number(feeRate),
          spreadBps: Number(spreadBps),
          slippageBps: Number(slippageBps),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setStatus("error");
        setError(body.error ?? "Request failed");
        return;
      }
      const json = (await res.json()) as BacktestResult;
      setResult(json);
      setStatus("done");
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus("cancelled");
        setError(
          "Cancelled — in-flight and future historical-data requests were stopped immediately. " +
            "If computation had already started, it ran to completion and this response was discarded.",
        );
      } else {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Request failed");
      }
    }
  }

  function cancel() {
    controllerRef.current?.abort();
  }

  return (
    <PageShell accent="#f59e0b">
      <PixelCard title="Backtest — Deterministic, Long-Only, Paper-Only" accent="#f59e0b">
        <p className="text-xs text-warning">
          Historical simulation only — no real orders, no real money, no persistence. Confidence
          figures throughout are heuristic, not a probability of profit.
        </p>
      </PixelCard>

      <PixelCard title="Configuration" accent="#f59e0b">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>
            Symbol
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="block w-full border border-border bg-background px-2 py-1">
              {SUPPORTED_SYMBOLS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Start (UTC)
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
          <label>
            End (UTC)
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
          <label>
            Initial balance (USDT)
            <input value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
          <label>
            Fee rate
            <input value={feeRate} onChange={(e) => setFeeRate(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
          <label>
            Spread (bps)
            <input value={spreadBps} onChange={(e) => setSpreadBps(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
          <label>
            Slippage (bps)
            <input value={slippageBps} onChange={(e) => setSlippageBps(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={status === "running"}
            onClick={run}
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
          >
            {status === "running" ? "Running…" : "Run"}
          </button>
          <button
            type="button"
            disabled={status !== "running"}
            onClick={cancel}
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </PixelCard>

      {result ? (
        <>
          <PixelCard title="Metrics" accent="#f59e0b">
            <StatLine label="Net profit (USDT)" value={result.metrics.netProfit} />
            <StatLine label="Total return" value={`${(result.metrics.totalReturn * 100).toFixed(2)}%`} />
            <StatLine label="Win rate" value={`${(result.metrics.winRate * 100).toFixed(1)}%`} />
            <StatLine label="Profit factor" value={result.metrics.profitFactor?.toFixed(2) ?? (result.metrics.profitFactorReason ?? "n/a")} />
            <StatLine label="Max drawdown" value={`${(result.metrics.maxDrawdownPct * 100).toFixed(2)}%`} />
            <StatLine label="Sharpe (heuristic, per-bar)" value={result.metrics.sharpe?.toFixed(2) ?? "n/a (insufficient variance)"} />
            <StatLine label="Trades" value={String(result.metrics.tradeCount)} />
            <StatLine label="Buy-and-hold net profit (USDT)" value={(Number(result.benchmark.finalCash) - Number(result.config.initialBalance)).toFixed(2)} />
          </PixelCard>

          <PixelCard title="Equity Curve" accent="#f59e0b">
            <EquitySparkline points={result.equityCurveChart} />
          </PixelCard>

          <PixelCard title="Trade Ledger" accent="#f59e0b">
            <button
              type="button"
              onClick={() => downloadCsv(result.tradeLedger, result.symbol)}
              className="mb-2 rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5"
            >
              Download CSV
            </button>
            <div className="max-h-64 overflow-auto text-[10px]">
              {result.tradeLedger.map((t, i) => (
                <div key={i} className="border-t border-border/40 py-1 first:border-t-0">
                  {new Date(t.entryTime).toISOString()} @ {t.entryPrice} → {new Date(t.exitTime).toISOString()} @{" "}
                  {t.exitPrice} ({t.exitReason}) P&L {t.realizedPnl}
                </div>
              ))}
            </div>
          </PixelCard>

          <PixelCard title="Assumptions & Warnings" accent="#f59e0b">
            {result.warnings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data-quality warnings for this run.</p>
            ) : (
              result.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-muted-foreground">{w}</p>
              ))
            )}
            <p className="mt-2 text-[10px] text-muted-foreground/70">
              Malformed candles: {result.dataQuality.malformedCount}, invalid OHLC: {result.dataQuality.invalidOhlcCount}, gaps: {result.dataQuality.gapCount}.
            </p>
          </PixelCard>
        </>
      ) : null}
    </PageShell>
  );
}
