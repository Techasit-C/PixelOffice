import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { runBacktest } from "@/lib/backtest/run-backtest";
import type { EvaluationWindow } from "@/lib/backtest/candle-window";

const H4 = 14_400_000;
const H1 = 3_600_000;
const D1 = 86_400_000;

function buildSeries(count: number, startOpenTime: number, durationMs: number, seed = 100): Candle[] {
  const candles: Candle[] = [];
  let price = seed;
  for (let i = 0; i < count; i++) {
    const openTime = startOpenTime + i * durationMs;
    const open = price;
    price = price + 0.5 + (i % 3 === 0 ? 1.5 : 0);
    const close = price;
    candles.push({ openTime, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume: 100 + i });
  }
  return candles;
}

// Perturbs every candle strictly after cutoffIndex (exclusive) to a wildly different,
// but still structurally valid, price path — proves nothing about the shape of the
// perturbation matters, only that it happens strictly after the cutoff.
function perturbAfter(series: Candle[], cutoffIndex: number): Candle[] {
  return series.map((c, i) => {
    if (i <= cutoffIndex) return c;
    const flipped = 100000 - c.close;
    return { ...c, open: flipped, high: flipped + 5, low: flipped - 5, close: flipped };
  });
}

const config = {
  spreadBps: 5,
  slippageBps: 5,
  feeRate: new Prisma.Decimal("0.001"),
  initialBalance: new Prisma.Decimal("10000"),
  finalize: false, // no synthetic end-of-test exit in either run being compared
};

const warmupStart = 0;
const normalizedStart = 60 * H4;
const normalizedEnd = 90 * H4; // 30 evaluation bars, cutoff sits inside this range
const window: EvaluationWindow = { normalizedStart, normalizedEnd, effectiveEndBoundary: normalizedEnd };
const cutoffTime = 75 * H4; // T — comfortably inside the evaluation range

function runAt(primary: Candle[], oneHour: Candle[], oneDay: Candle[], finalize = false) {
  return runBacktest(primary, oneHour, oneDay, window, { ...config, finalize });
}

describe("future-independence — perturbing PRIMARY candles strictly after T never changes decisions at/before T", () => {
  const basePrimary = buildSeries(90, warmupStart, H4);
  const oneHour = buildSeries(2200, warmupStart - 50 * H1, H1, 50);
  const oneDay = buildSeries(140, warmupStart - 50 * D1, D1, 200);
  const cutoffIndex = basePrimary.findIndex((c) => c.openTime + H4 === cutoffTime);

  const baseline = runAt(basePrimary, oneHour, oneDay);
  const perturbed = runAt(perturbAfter(basePrimary, cutoffIndex), oneHour, oneDay);

  it("every event at or before T is byte-identical between the two runs", () => {
    const baselineUpToT = baseline.simulate.events.filter((e) => e.time <= cutoffTime);
    const perturbedUpToT = perturbed.simulate.events.filter((e) => e.time <= cutoffTime);
    expect(perturbedUpToT).toEqual(baselineUpToT);
  });

  it("every trade ledger entry entered at or before T is byte-identical", () => {
    const baselineTrades = baseline.simulate.tradeLedger.filter((t) => t.entryTime <= cutoffTime);
    const perturbedTrades = perturbed.simulate.tradeLedger.filter((t) => t.entryTime <= cutoffTime);
    expect(perturbedTrades).toEqual(baselineTrades);
  });

  it("every equity-curve point at or before T is byte-identical", () => {
    const baselinePoints = baseline.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    const perturbedPoints = perturbed.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    expect(perturbedPoints).toEqual(baselinePoints);
  });
});

describe("future-independence — perturbing 1H confirmation candles strictly after T never changes decisions at/before T", () => {
  const primary = buildSeries(90, warmupStart, H4);
  const baseOneHour = buildSeries(2200, warmupStart - 50 * H1, H1, 50);
  const oneDay = buildSeries(140, warmupStart - 50 * D1, D1, 200);
  const cutoffIndex = baseOneHour.findIndex((c) => c.openTime + H1 >= cutoffTime);

  const baseline = runAt(primary, baseOneHour, oneDay);
  const perturbed = runAt(primary, perturbAfter(baseOneHour, cutoffIndex), oneDay);

  it("every equity-curve point at or before T is byte-identical when only 1h data changes after T", () => {
    const baselinePoints = baseline.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    const perturbedPoints = perturbed.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    expect(perturbedPoints).toEqual(baselinePoints);
  });
});

describe("future-independence — perturbing 1D confirmation candles strictly after T never changes decisions at/before T", () => {
  const primary = buildSeries(90, warmupStart, H4);
  const oneHour = buildSeries(2200, warmupStart - 50 * H1, H1, 50);
  const baseOneDay = buildSeries(140, warmupStart - 50 * D1, D1, 200);
  const cutoffIndex = baseOneDay.findIndex((c) => c.openTime + D1 >= cutoffTime);

  const baseline = runAt(primary, oneHour, baseOneDay);
  const perturbed = runAt(primary, oneHour, perturbAfter(baseOneDay, cutoffIndex));

  it("every equity-curve point at or before T is byte-identical when only 1d data changes after T", () => {
    const baselinePoints = baseline.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    const perturbedPoints = perturbed.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    expect(perturbedPoints).toEqual(baselinePoints);
  });
});

describe("finalize is purely additive", () => {
  const primary = buildSeries(90, warmupStart, H4);
  const oneHour = buildSeries(2200, warmupStart - 50 * H1, H1, 50);
  const oneDay = buildSeries(140, warmupStart - 50 * D1, D1, 200);

  it("finalize:true output equals finalize:false output plus at most one END_OF_TEST entry, nothing else changed", () => {
    const withoutFinalize = runAt(primary, oneHour, oneDay, false);
    const withFinalize = runAt(primary, oneHour, oneDay, true);

    const closedTradesWithout = withoutFinalize.simulate.tradeLedger;
    const closedTradesWith = withFinalize.simulate.tradeLedger.filter((t) => t.exitReason !== "END_OF_TEST");
    expect(closedTradesWith).toEqual(closedTradesWithout);
  });
});

describe("structural sequencing — no entry at or before its own signal's decision time", () => {
  it("every ENTRY_PROCESSED event's time is >= the most recent SIGNAL_COMPUTED event's time, with a strictly greater sequenceNumber when equal", () => {
    const primary = buildSeries(90, warmupStart, H4);
    const oneHour = buildSeries(2200, warmupStart - 50 * H1, H1, 50);
    const oneDay = buildSeries(140, warmupStart - 50 * D1, D1, 200);
    const result = runAt(primary, oneHour, oneDay);

    const signalEvents = result.simulate.events.filter((e) => e.type === "SIGNAL_COMPUTED");
    const entryEvents = result.simulate.events.filter((e) => e.type === "ENTRY_PROCESSED");
    for (const entry of entryEvents) {
      const priorSignal = [...signalEvents].reverse().find((s) => s.time <= entry.time);
      expect(priorSignal).toBeDefined();
      if (priorSignal!.time === entry.time) {
        expect(entry.sequenceNumber).toBeGreaterThan(priorSignal!.sequenceNumber);
      }
    }
  });
});
