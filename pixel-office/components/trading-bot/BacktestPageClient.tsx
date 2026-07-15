"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";
import { PixelCard, StatLine } from "@/components/ui/PixelCard";
import { tradeLedgerToCsv, CsvExportError } from "@/lib/backtest/csv";
import { SUPPORTED_SYMBOLS } from "@/lib/trading-signals/config";
import {
  validateBacktestRequestInput,
  type BacktestFormInput,
  type FieldErrors,
  type FieldName,
} from "@/lib/backtest/validate-request-input";
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

// tradeLedgerToCsv fail-closed-rejects a malformed monetary/timestamp field rather
// than silently exporting it — that should never happen against a real backtest
// result, but a thrown CsvExportError must surface as an error message, not an
// uncaught exception.
function downloadCsv(entries: TradeLedgerEntry[], symbol: string, onError: (message: string) => void) {
  let csv: string;
  try {
    csv = tradeLedgerToCsv(entries);
  } catch (err) {
    onError(err instanceof CsvExportError ? err.message : "Failed to generate CSV export");
    return;
  }
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backtest-${symbol.replace("/", "-")}-trade-ledger.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-0.5 text-[10px] text-danger">
      {message}
    </p>
  );
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<BacktestResult | null>(null);
  // True once a result existed and the user has since edited any configuration
  // field — the result is no longer trustworthy for the CURRENT form values, even
  // though `result` itself has already been cleared (see onFieldChange below).
  const [resultStale, setResultStale] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const symbolRef = useRef<HTMLSelectElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const initialBalanceRef = useRef<HTMLInputElement>(null);
  const feeRateRef = useRef<HTMLInputElement>(null);
  const spreadBpsRef = useRef<HTMLInputElement>(null);
  const slippageBpsRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<FieldName, React.RefObject<HTMLElement | null>> = {
    symbol: symbolRef, start: startRef, end: endRef, initialBalance: initialBalanceRef,
    feeRate: feeRateRef, spreadBps: spreadBpsRef, slippageBps: slippageBpsRef,
  };

  // Changing ANY configuration field, at any time, must immediately invalidate a
  // previously displayed result: cleared here (not merely hidden), so no code path
  // can accidentally render it against the new, not-yet-run form values.
  function onFieldChange<T>(field: FieldName, setter: (v: T) => void, value: T) {
    setter(value);
    if (result !== null) {
      setResult(null);
      setResultStale(true);
    }
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function focusField(field: FieldName) {
    fieldRefs[field].current?.focus();
  }

  async function run() {
    // Clear any previous result BEFORE validation or fetching — no stale result may
    // ever be visible under the new attempt, regardless of how it ends.
    setResult(null);
    setResultStale(false);
    setError(null);
    setFieldErrors({});
    setStatus("validating");

    const input: BacktestFormInput = { symbol, start, end, initialBalance, feeRate, spreadBps, slippageBps };
    const validation = validateBacktestRequestInput(input);
    if (!validation.ok) {
      setStatus("error");
      setFieldErrors(validation.errors);
      setError("Fix the highlighted fields and try again.");
      if (validation.firstInvalidField) focusField(validation.firstInvalidField);
      return; // no fetch is ever issued for invalid client input
    }
    const { requestedStart, requestedEnd, initialBalance: vBalance, feeRate: vFeeRate, spreadBps: vSpread, slippageBps: vSlippage } = validation.parsed!;

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
          initialBalance: vBalance,
          feeRate: vFeeRate,
          spreadBps: vSpread,
          slippageBps: vSlippage,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setStatus("error");
        setError(body.error ?? "Request failed");
        return; // result remains null — server-side rejection never shows stale data
      }
      const json = (await res.json()) as BacktestResult;
      setResult(json);
      setResultStale(false);
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
      // result remains null on both timeout/provider-failure and cancellation paths
    }
  }

  function cancel() {
    controllerRef.current?.abort();
  }

  return (
    <PageShell accent="#f59e0b">
      <PixelCard
        title="Backtest — Deterministic, Long-Only, Paper-Only"
        accent="#f59e0b"
        right={
          <Link
            href="/trading-bot"
            aria-label="Back to Trading Bot"
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            ← Back to Trading Bot
          </Link>
        }
      >
        <p className="text-xs text-warning">
          Historical simulation only — no real orders, no real money, no persistence. Confidence
          figures throughout are heuristic, not a probability of profit.
        </p>
      </PixelCard>

      <PixelCard title="Configuration" accent="#f59e0b">
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <label htmlFor="backtest-symbol">
            Symbol
            <select
              id="backtest-symbol"
              ref={symbolRef}
              value={symbol}
              onChange={(e) => onFieldChange("symbol", setSymbol, e.target.value)}
              aria-invalid={fieldErrors.symbol ? true : undefined}
              aria-describedby={fieldErrors.symbol ? "backtest-symbol-error" : undefined}
              className="block w-full border border-border bg-background px-2 py-1"
            >
              {SUPPORTED_SYMBOLS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <FieldError id="backtest-symbol-error" message={fieldErrors.symbol} />
          </label>
          <label htmlFor="backtest-start">
            Start (UTC)
            <input
              id="backtest-start"
              ref={startRef}
              type="date"
              value={start}
              onChange={(e) => onFieldChange("start", setStart, e.target.value)}
              aria-invalid={fieldErrors.start ? true : undefined}
              aria-describedby={fieldErrors.start ? "backtest-start-error" : undefined}
              className="block w-full border border-border bg-background px-2 py-1"
            />
            <FieldError id="backtest-start-error" message={fieldErrors.start} />
          </label>
          <label htmlFor="backtest-end">
            End (UTC)
            <input
              id="backtest-end"
              ref={endRef}
              type="date"
              value={end}
              onChange={(e) => onFieldChange("end", setEnd, e.target.value)}
              aria-invalid={fieldErrors.end ? true : undefined}
              aria-describedby={fieldErrors.end ? "backtest-end-error" : undefined}
              className="block w-full border border-border bg-background px-2 py-1"
            />
            <FieldError id="backtest-end-error" message={fieldErrors.end} />
          </label>
          <label htmlFor="backtest-initial-balance">
            Initial balance (USDT)
            <input
              id="backtest-initial-balance"
              ref={initialBalanceRef}
              value={initialBalance}
              onChange={(e) => onFieldChange("initialBalance", setInitialBalance, e.target.value)}
              aria-invalid={fieldErrors.initialBalance ? true : undefined}
              aria-describedby={fieldErrors.initialBalance ? "backtest-initial-balance-error" : undefined}
              className="block w-full border border-border bg-background px-2 py-1"
            />
            <FieldError id="backtest-initial-balance-error" message={fieldErrors.initialBalance} />
          </label>
          <label htmlFor="backtest-fee-rate">
            Fee rate
            <input
              id="backtest-fee-rate"
              ref={feeRateRef}
              value={feeRate}
              onChange={(e) => onFieldChange("feeRate", setFeeRate, e.target.value)}
              aria-invalid={fieldErrors.feeRate ? true : undefined}
              aria-describedby={fieldErrors.feeRate ? "backtest-fee-rate-error" : undefined}
              className="block w-full border border-border bg-background px-2 py-1"
            />
            <FieldError id="backtest-fee-rate-error" message={fieldErrors.feeRate} />
          </label>
          <label htmlFor="backtest-spread-bps">
            Spread (bps)
            <input
              id="backtest-spread-bps"
              ref={spreadBpsRef}
              value={spreadBps}
              onChange={(e) => onFieldChange("spreadBps", setSpreadBps, e.target.value)}
              aria-invalid={fieldErrors.spreadBps ? true : undefined}
              aria-describedby={fieldErrors.spreadBps ? "backtest-spread-bps-error" : undefined}
              className="block w-full border border-border bg-background px-2 py-1"
            />
            <FieldError id="backtest-spread-bps-error" message={fieldErrors.spreadBps} />
          </label>
          <label htmlFor="backtest-slippage-bps">
            Slippage (bps)
            <input
              id="backtest-slippage-bps"
              ref={slippageBpsRef}
              value={slippageBps}
              onChange={(e) => onFieldChange("slippageBps", setSlippageBps, e.target.value)}
              aria-invalid={fieldErrors.slippageBps ? true : undefined}
              aria-describedby={fieldErrors.slippageBps ? "backtest-slippage-bps-error" : undefined}
              className="block w-full border border-border bg-background px-2 py-1"
            />
            <FieldError id="backtest-slippage-bps-error" message={fieldErrors.slippageBps} />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
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
        {error ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </PixelCard>

      {resultStale ? (
        <PixelCard title="Result" accent="#f59e0b">
          <p role="status" className="text-xs text-warning">
            Inputs changed — run the backtest again.
          </p>
        </PixelCard>
      ) : null}

      {result ? (
        <>
          <PixelCard title="Results for" accent="#f59e0b">
            <p className="text-[10px] text-muted-foreground/70">
              This summary reflects the configuration the server actually used to compute the run
              below — it never changes when you edit the form above.
            </p>
            <StatLine label="Symbol" value={result.symbol} />
            <StatLine
              label="Evaluation range (UTC)"
              value={`${new Date(result.actualEvaluationRange.start).toISOString()} → ${new Date(result.actualEvaluationRange.end).toISOString()}`}
            />
            <StatLine label="Initial balance (USDT)" value={result.config.initialBalance} />
            <StatLine label="Fee rate" value={result.config.feeRate} />
            <StatLine label="Spread (bps)" value={String(result.config.spreadBps)} />
            <StatLine label="Slippage (bps)" value={String(result.config.slippageBps)} />
          </PixelCard>

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
              onClick={() => downloadCsv(result.tradeLedger, result.symbol, setError)}
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
