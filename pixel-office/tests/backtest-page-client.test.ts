/** @vitest-environment jsdom */
// Proves the result-integrity fix behaviorally, by actually rendering the component
// and driving real user interaction — static source scanning cannot prove state
// transitions. Uses the repo's per-file `@vitest-environment` pragma so this is the
// only test file paying the jsdom cost; the rest of the suite stays on the default
// (faster) node environment.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BacktestResult } from "@/lib/backtest/types";

// PageShell renders AppNav, which calls usePathname() — real only inside Next's App
// Router context, which jsdom-under-Vitest doesn't provide. Mocked, not stubbed away
// entirely, so AppNav still renders its real links/labels.
vi.mock("next/navigation", () => ({
  usePathname: () => "/trading-bot/backtest",
}));

const { default: BacktestPageClient } = await import("@/components/trading-bot/BacktestPageClient");

// This file is intentionally .ts, not .tsx: vitest.config.ts scopes the whole suite
// to "pure-logic .ts tests only" — createElement() keeps this file's syntax that
// contract-compliant while still exercising the real component via a genuine jsdom
// render, rather than widening the repo's test-file policy to include JSX.
function renderBacktestPageClient() {
  return render(createElement(BacktestPageClient));
}

function mockResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  return {
    engineVersion: "phase3-v1",
    symbol: "BTC/USDT",
    timeframe: "4h",
    dataSource: "MEXC public klines",
    requestedRange: { start: 0, end: 100 },
    fetchedWarmupRange: { primary: { start: 0, end: 100 }, oneHour: { start: 0, end: 100 }, oneDay: { start: 0, end: 100 } },
    actualEvaluationRange: { start: 1_704_067_200_000, end: 1_711_929_600_000 }, // 2024-01-01 -> 2024-04-01 UTC
    candleCounts: { primary: 100, oneHour: 100, oneDay: 100 },
    config: { initialBalance: "10000.00000000", feeRate: "0.00100000", spreadBps: 5, slippageBps: 5, riskPerTradeFraction: "0.00500000" },
    dataQuality: { malformedCount: 0, invalidOhlcCount: 0, exactDuplicateCount: 0, conflictingDuplicateCount: 0, reordered: false, reorderCount: 0, gapCount: 0, gaps: [], coverageShortfall: null },
    tradeLedger: [],
    unexecutedSignals: [],
    equityCurve: [{ time: 0, equity: "10000" }, { time: 1, equity: "10100" }],
    equityCurveChart: [{ time: 0, equity: "10000" }, { time: 1, equity: "10100" }],
    metrics: {
      netProfit: "100.00000000", totalReturn: 0.01, winRate: 0, lossRate: 0, profitFactor: null,
      profitFactorReason: "undefined — no losing trades in this run", maxDrawdownPct: 0,
      sharpe: null, tradeCount: 0, averageWin: "0.00000000", averageLoss: "0.00000000", expectancy: "0.00000000",
    },
    benchmark: {
      entryTime: 0, entryPrice: "100.00000000", quantity: "1.00000000", exitTime: 1, exitPrice: "110.00000000",
      finalCash: "10100.00000000",
      metrics: {
        netProfit: "100.00000000", totalReturn: 0.01, winRate: 0, lossRate: 0, profitFactor: null,
        profitFactorReason: "undefined — no losing trades in this run", maxDrawdownPct: 0,
        sharpe: null, tradeCount: 0, averageWin: "0.00000000", averageLoss: "0.00000000", expectancy: "0.00000000",
      },
      equityCurve: [{ time: 0, equity: "10000" }, { time: 1, equity: "10100" }],
    },
    warnings: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return { ok, status, statusText: ok ? "OK" : "Error", json: async () => body } as unknown as Response;
}

// Scopes queries to the "Results for" card — needed because the symbol string also
// appears as an <option> in the Symbol <select>, so an unscoped getByText("BTC/USDT")
// matches both and throws "multiple elements found".
function resultsForCard() {
  const heading = screen.getByText("Results for");
  const section = heading.closest("section");
  if (!section) throw new Error('"Results for" PixelCard section not found');
  return within(section as HTMLElement);
}

// The two date inputs need a valid ~90-day range for client validation to pass.
async function fillValidRange() {
  fireEvent.change(screen.getByLabelText(/^Start/), { target: { value: "2024-01-01" } });
  fireEvent.change(screen.getByLabelText(/^End/), { target: { value: "2024-04-01" } });
}

describe("BacktestPageClient — result integrity", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    // Vitest isn't running in `globals` mode (test.globals is unset in
    // vitest.config.ts, intentionally, for the rest of this "pure-logic" suite), so
    // React Testing Library's automatic afterEach(cleanup) never registers — without
    // this, DOM nodes from every previous render() in this file would accumulate.
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("1. changing any field after a successful result hides Metrics/Equity Curve/Trade Ledger and shows the 'inputs changed' state", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(mockResult()));
    renderBacktestPageClient();

    await fillValidRange();
    await user.click(screen.getByRole("button", { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByText("Metrics")).toBeInTheDocument());
    expect(screen.getByText("Trade Ledger")).toBeInTheDocument();
    expect(screen.getByText("Equity Curve")).toBeInTheDocument();

    // Touch a single field — any field, not necessarily one that affects correctness.
    fireEvent.change(screen.getByLabelText(/Slippage/), { target: { value: "7" } });

    expect(screen.queryByText("Metrics")).not.toBeInTheDocument();
    expect(screen.queryByText("Trade Ledger")).not.toBeInTheDocument();
    expect(screen.queryByText("Equity Curve")).not.toBeInTheDocument();
    expect(screen.queryByText(/Download CSV/)).not.toBeInTheDocument();
    expect(screen.getByText(/Inputs changed — run the backtest again/)).toBeInTheDocument();
  });

  it("2. invalid client input (bad date range) never calls fetch", async () => {
    const user = userEvent.setup();
    renderBacktestPageClient();
    // start/end left empty -> invalid
    await user.click(screen.getByRole("button", { name: /^Run$/ }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a valid start date/)).toBeInTheDocument();
  });

  it("2b. an out-of-range initial balance never calls fetch and is reported on that field", async () => {
    const user = userEvent.setup();
    renderBacktestPageClient();
    await fillValidRange();
    fireEvent.change(screen.getByLabelText(/Initial balance/), { target: { value: "1" } });

    await user.click(screen.getByRole("button", { name: /^Run$/ }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Initial balance/)).toHaveFocus();
    const message = screen.getByLabelText(/Initial balance/).getAttribute("aria-describedby");
    expect(message).toBeTruthy();
    expect(document.getElementById(message!)?.textContent).toMatch(/between 100 and 1000000/);
  });

  it("3a. a server-side API rejection leaves no stale result visible", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(mockResult()))
      .mockResolvedValueOnce(jsonResponse({ error: "Historical data fetch failed or timed out" }, false, 400));
    renderBacktestPageClient();

    await fillValidRange();
    await user.click(screen.getByRole("button", { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByText("Metrics")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByText(/Historical data fetch failed or timed out/)).toBeInTheDocument());

    expect(screen.queryByText("Metrics")).not.toBeInTheDocument();
    expect(screen.queryByText("Trade Ledger")).not.toBeInTheDocument();
    expect(screen.queryByText(/Inputs changed/)).not.toBeInTheDocument(); // this is a fresh failed attempt, not a stale-input state
  });

  it("3b. a client-side validation failure on a second attempt leaves no stale result from the first successful run", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(mockResult()));
    renderBacktestPageClient();

    await fillValidRange();
    await user.click(screen.getByRole("button", { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByText("Metrics")).toBeInTheDocument());

    // Break the end date so the SAME Run click now fails client-side validation.
    fireEvent.change(screen.getByLabelText(/^End/), { target: { value: "2023-01-01" } });
    await user.click(screen.getByRole("button", { name: /^Run$/ }));

    expect(screen.queryByText("Metrics")).not.toBeInTheDocument();
    expect(screen.getByText(/End date must be after the start date/)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1); // the second attempt never reached fetch
  });

  it("4. cancellation leaves no stale result visible", async () => {
    const user = userEvent.setup();
    let capturedSignal: AbortSignal | undefined;
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(mockResult()))
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            capturedSignal = init.signal as AbortSignal;
            capturedSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      );
    renderBacktestPageClient();

    await fillValidRange();
    await user.click(screen.getByRole("button", { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByText("Metrics")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^Run$/ })); // second attempt, will be cancelled
    await waitFor(() => expect(capturedSignal).toBeDefined());
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));

    await waitFor(() => expect(screen.getByText(/Cancelled/)).toBeInTheDocument());
    expect(screen.queryByText("Metrics")).not.toBeInTheDocument();
    expect(screen.queryByText("Trade Ledger")).not.toBeInTheDocument();
  });

  it("5. a successful result displays the server-echoed configuration snapshot under 'Results for'", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(mockResult({ symbol: "ETH/USDT", config: { initialBalance: "25000.00000000", feeRate: "0.00200000", spreadBps: 8, slippageBps: 12, riskPerTradeFraction: "0.00500000" } })),
    );
    renderBacktestPageClient();
    await fillValidRange();
    await user.click(screen.getByRole("button", { name: /^Run$/ }));

    await waitFor(() => expect(screen.getByText("Results for")).toBeInTheDocument());
    const card = resultsForCard();
    expect(card.getByText("ETH/USDT")).toBeInTheDocument();
    expect(card.getByText("25000.00000000")).toBeInTheDocument();
    expect(card.getByText("0.00200000")).toBeInTheDocument();
    expect(card.getByText("8")).toBeInTheDocument();
    expect(card.getByText("12")).toBeInTheDocument();
    // The evaluation range is rendered as UTC ISO timestamps derived from the server value.
    expect(card.getByText(/2024-01-01T00:00:00\.000Z/)).toBeInTheDocument();
  });

  it("6. a second successful run completely replaces the first result, not merges with it", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(mockResult({ symbol: "BTC/USDT", metrics: { ...mockResult().metrics, tradeCount: 3 } })))
      .mockResolvedValueOnce(jsonResponse(mockResult({ symbol: "ETH/USDT", metrics: { ...mockResult().metrics, tradeCount: 9 } })));
    renderBacktestPageClient();

    await fillValidRange();
    await user.click(screen.getByRole("button", { name: /^Run$/ }));
    await waitFor(() => expect(resultsForCard().getByText("BTC/USDT")).toBeInTheDocument());
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /^Run$/ }));
    await waitFor(() => expect(resultsForCard().getByText("ETH/USDT")).toBeInTheDocument());

    expect(resultsForCard().queryByText("BTC/USDT")).not.toBeInTheDocument();
    expect(screen.queryAllByText("3").length).toBe(0);
    expect(screen.getAllByText("9").length).toBeGreaterThan(0);
  });
});
