import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { runSimulation, type SignalProviderResult, type SimulateConfig } from "@/lib/backtest/simulate";
import type { EvaluationWindow } from "@/lib/backtest/candle-window";

const H4 = 14_400_000;
function bar(openTime: number, open: number, high: number, low: number, close: number): Candle {
  return { openTime, open, high, low, close, volume: 100 };
}

function windowFor(startBarIndexOpenTime: number, endBoundary: number): EvaluationWindow {
  return { normalizedStart: startBarIndexOpenTime, normalizedEnd: endBoundary, effectiveEndBoundary: endBoundary };
}

const WAIT: SignalProviderResult = { direction: "WAIT", entryZone: null, stopLoss: null, takeProfit1: null };

function baseConfig(overrides: Partial<SimulateConfig> = {}): SimulateConfig {
  return {
    spreadBps: 0,
    slippageBps: 0,
    feeRate: new Prisma.Decimal("0"),
    initialBalance: new Prisma.Decimal("10000"),
    finalize: true,
    ...overrides,
  };
}

describe("runSimulation — decision-bar/tradable-bar wiring (spec §6.3 worked example)", () => {
  // A: 04:00-08:00 (decision-only), B: 08:00-12:00 (both, first tradable),
  // C: 12:00-16:00 (tradable-only, final).
  const A = bar(1 * H4, 100, 101, 99, 100);
  const B = bar(2 * H4, 100, 106, 99, 105);
  const C = bar(3 * H4, 105, 106, 104, 105);
  const candles = [A, B, C];
  const window = windowFor(2 * H4, 4 * H4);

  it("never calls the signal provider for bar C (tradable-only, no new signal)", () => {
    const calls: number[] = [];
    runSimulation(candles, window, H4, (closed, now) => {
      calls.push(now);
      return WAIT;
    }, baseConfig());
    expect(calls).toEqual([2 * H4, 3 * H4]); // A's close and B's close only — never C's
  });

  it("the equity curve's first point is the synthetic baseline at normalizedStart, then one point per tradable bar", () => {
    const result = runSimulation(candles, window, H4, () => WAIT, baseConfig());
    expect(result.equityCurve.map((p) => p.time)).toEqual([2 * H4, 3 * H4, 4 * H4]);
  });
});

describe("runSimulation — entry only fills on the bar AFTER the signal, never the signal bar itself", () => {
  const A = bar(1 * H4, 100, 101, 99, 100);
  const B = bar(2 * H4, 100, 106, 99, 105); // entry bar: open=100
  const C = bar(3 * H4, 105, 120, 104, 118); // TP1 touched here
  const candles = [A, B, C];
  const window = windowFor(2 * H4, 4 * H4);
  const LONG: SignalProviderResult = {
    direction: "LONG",
    entryZone: { low: 99, high: 101 },
    stopLoss: 90,
    takeProfit1: 115,
  };

  it("fills at B.open (the bar after A's signal), never at A's own price levels", () => {
    const result = runSimulation(candles, window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig());
    expect(result.tradeLedger.length).toBe(1);
    expect(result.tradeLedger[0].entryTime).toBe(2 * H4); // B.openTime, not A's
    expect(result.tradeLedger[0].entryPrice).toBe("100.00000000"); // B.open, never any field of A
  });

  it("a position filled at the entry bar's open can still exit within that SAME bar via steps 2-3", () => {
    const gapUpBar = bar(2 * H4, 100, 116, 99, 105); // touches TP1 (115) intrabar, same bar as the fill
    const result = runSimulation([A, gapUpBar, C], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig());
    expect(result.tradeLedger.length).toBe(1);
    expect(result.tradeLedger[0].exitReason).toBe("TP1");
    expect(result.tradeLedger[0].exitTime).toBe(3 * H4); // gapUpBar's close
  });
});

describe("runSimulation — pending entry expiry", () => {
  const A = bar(1 * H4, 100, 101, 99, 100);
  const gap = bar(5 * H4, 100, 101, 99, 100); // non-contiguous next bar
  const window = windowFor(2 * H4, 8 * H4);
  const LONG: SignalProviderResult = { direction: "LONG", entryZone: { low: 99, high: 101 }, stopLoss: 90, takeProfit1: 115 };

  it("expires GAP_BEFORE_ENTRY when the next bar is non-contiguous, and never trades", () => {
    const result = runSimulation([A, gap], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig());
    expect(result.tradeLedger.length).toBe(0);
    expect(result.unexecutedSignals.some((u) => u.reason === "GAP_BEFORE_ENTRY")).toBe(true);
  });
});

describe("runSimulation — forced end-of-test liquidation and final-equity replacement", () => {
  const A = bar(1 * H4, 100, 101, 99, 100);
  const B = bar(2 * H4, 100, 106, 99, 105);
  const C = bar(3 * H4, 105, 106, 104, 105); // never touches stop or TP1
  const window = windowFor(2 * H4, 4 * H4);
  const LONG: SignalProviderResult = { direction: "LONG", entryZone: { low: 99, high: 101 }, stopLoss: 90, takeProfit1: 200 };

  it("finalize:true force-closes an open position at the final bar's close with exitReason END_OF_TEST", () => {
    const result = runSimulation([A, B, C], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig({ finalize: true }));
    expect(result.tradeLedger.length).toBe(1);
    expect(result.tradeLedger[0].exitReason).toBe("END_OF_TEST");
    expect(result.tradeLedger[0].exitTime).toBe(4 * H4);
  });

  it("finalize:false leaves the position open — no synthetic trade", () => {
    const result = runSimulation([A, B, C], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig({ finalize: false }));
    expect(result.tradeLedger.length).toBe(0);
  });

  it("the final equity point is REPLACED (not duplicated) by the post-liquidation value", () => {
    const result = runSimulation([A, B, C], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig({ finalize: true }));
    const finalPoints = result.equityCurve.filter((p) => p.time === 4 * H4);
    expect(finalPoints.length).toBe(1);
  });
});

describe("runSimulation — sequence numbers order SIGNAL_COMPUTED before the following ENTRY_PROCESSED, even at equal timestamps", () => {
  const A = bar(1 * H4, 100, 101, 99, 100);
  const B = bar(2 * H4, 100, 101, 99, 100); // B.openTime === A.closeTime
  const window = windowFor(2 * H4, 6 * H4);
  const LONG: SignalProviderResult = { direction: "LONG", entryZone: { low: 99, high: 101 }, stopLoss: 90, takeProfit1: 115 };

  it("SIGNAL_COMPUTED for A has a lower sequenceNumber than ENTRY_PROCESSED for B", () => {
    const result = runSimulation([A, B], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig());
    const signalEvent = result.events.find((e) => e.type === "SIGNAL_COMPUTED" && e.time === 2 * H4)!;
    const entryEvent = result.events.find((e) => e.type === "ENTRY_PROCESSED" && e.time === 2 * H4)!;
    expect(signalEvent.sequenceNumber).toBeLessThan(entryEvent.sequenceNumber);
  });
});
