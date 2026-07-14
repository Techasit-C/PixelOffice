import { describe, it, expect } from "vitest";
import { buildPlainLanguageSummary } from "@/lib/trading-signals/explanation";

const UNAVAILABLE_MACD = { macdLine: null, signalLine: null, histogram: null };
const UNAVAILABLE_BB = { middle: null, upper: null, lower: null, percentB: null };

describe("buildPlainLanguageSummary", () => {
  it("produces a Hold summary with no price detail when WAIT", () => {
    const summary = buildPlainLanguageSummary("WAIT", null, null, UNAVAILABLE_MACD, UNAVAILABLE_BB, null);
    expect(summary).toContain("Hold");
  });

  it("produces a Buy summary reflecting the actual computed diagnostics", () => {
    const summary = buildPlainLanguageSummary(
      "LONG",
      { low: 99, high: 101 },
      95,
      { macdLine: 1, signalLine: 0.5, histogram: 0.5 },
      { middle: 100, upper: 110, lower: 90, percentB: 0.15 },
      { oneHour: "ALIGNED", oneDay: "ALIGNED", adjustment: 15, reasoning: [] },
    );
    expect(summary).toContain("Buy");
    expect(summary).toContain("MACD bullish");
    expect(summary).toContain("near lower Bollinger Band");
    expect(summary).toContain("1h aligned, 1d aligned");
    expect(summary).toContain("Entry near 100.00");
    expect(summary).toContain("stop at 95.00");
  });

  it("produces a Sell summary for a SHORT direction", () => {
    const summary = buildPlainLanguageSummary(
      "SHORT",
      { low: 199, high: 201 },
      210,
      { macdLine: -1, signalLine: -0.5, histogram: -0.5 },
      { middle: 200, upper: 220, lower: 180, percentB: 0.85 },
      { oneHour: "OPPOSITE", oneDay: "NEUTRAL", adjustment: -15, reasoning: [] },
    );
    expect(summary).toContain("Sell");
    expect(summary).toContain("MACD bearish");
    expect(summary).toContain("near upper Bollinger Band");
    expect(summary).toContain("1h opposite, 1d neutral");
  });

  it("reports MACD/Bollinger/timeframe as unavailable when their inputs are unavailable", () => {
    const summary = buildPlainLanguageSummary("LONG", { low: 99, high: 101 }, 95, UNAVAILABLE_MACD, UNAVAILABLE_BB, null);
    expect(summary).toContain("MACD unavailable");
    expect(summary).toContain("Bollinger unavailable");
    expect(summary).toContain("timeframe confirmation unavailable");
  });

  it("never contains language implying guaranteed or certain profit", () => {
    const summary = buildPlainLanguageSummary(
      "LONG", { low: 99, high: 101 }, 95,
      { macdLine: 1, signalLine: 0.5, histogram: 0.5 },
      { middle: 100, upper: 110, lower: 90, percentB: 0.5 },
      null,
    );
    expect(summary).not.toMatch(/guarantee|certain|promise|sure thing/i);
  });

  it("always describes confidence as heuristic, and explicitly disclaims it as a probability", () => {
    const summary = buildPlainLanguageSummary(
      "LONG", { low: 99, high: 101 }, 95,
      { macdLine: 1, signalLine: 0.5, histogram: 0.5 },
      { middle: 100, upper: 110, lower: 90, percentB: 0.5 },
      null,
    );
    expect(summary.toLowerCase()).toContain("heuristic");
    // Must explicitly disclaim "not a probability" — never assert probability
    // as a fact (e.g. "70% probability of profit" or "win rate of 70%").
    expect(summary.toLowerCase()).toContain("not a probability of profit");
    expect(summary.toLowerCase()).not.toMatch(/\d+%?\s*(probability|win rate|likelihood)\s+of\s+profit/);
  });
});
