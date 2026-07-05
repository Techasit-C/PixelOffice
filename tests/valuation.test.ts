import { describe, it, expect } from "vitest";
import {
  aggregateSource,
  computeAllocation,
  computeTotals,
  netDividend,
  valueHolding,
  type HoldingValuationInput,
} from "@/lib/portfolio/valuation";

const base: HoldingValuationInput = {
  assetSymbol: "VOO",
  assetType: "ETF",
  currency: "USD",
  quantity: "20",
  avgCostNative: "150",
  avgCostThb: "5050",
  currentPrice: "180",
  priceSource: "finnhub",
};

describe("valueHolding", () => {
  it("computes native + THB market value and unrealized P&L", () => {
    const v = valueHolding(base, "34");
    expect(v.currentValueNative.toString()).toBe("3600"); // 180 * 20
    expect(v.currentValueBase.toString()).toBe("122400"); // 3600 * 34 (today's FX)
    expect(v.totalCostBasisNative.toString()).toBe("3000"); // 150 * 20
    expect(v.totalCostBasisThb.toString()).toBe("101000"); // 5050 * 20 (snapshot FX)
    expect(v.unrealizedPnlNative.toString()).toBe("600");
    expect(v.unrealizedPnlBase.toString()).toBe("21400"); // 122400 - 101000
    expect(v.unrealizedPnlPct).toBe(20); // 600/3000
  });

  it("THB cost basis is NOT re-valued at today's FX (immutability)", () => {
    // Same holding, very different today's FX -> THB cost basis is unchanged.
    const a = valueHolding(base, "20");
    const b = valueHolding(base, "50");
    expect(a.totalCostBasisThb.toString()).toBe("101000");
    expect(b.totalCostBasisThb.toString()).toBe("101000");
    // ...but market value DOES move with today's FX.
    expect(a.currentValueBase.toString()).toBe("72000"); // 3600 * 20
    expect(b.currentValueBase.toString()).toBe("180000"); // 3600 * 50
  });

  it("empty holding (qty 0) -> zeros, no divide-by-zero", () => {
    const v = valueHolding({ ...base, quantity: "0", avgCostNative: "0", avgCostThb: "0" }, "34");
    expect(v.currentValueBase.toString()).toBe("0");
    expect(v.unrealizedPnlPct).toBe(0);
  });
});

describe("computeTotals", () => {
  it("aggregates base (THB) and USD totals", () => {
    const h1 = valueHolding(base, "34");
    const h2 = valueHolding(
      { ...base, assetSymbol: "BTC", assetType: "CRYPTO", quantity: "1", avgCostNative: "50000", avgCostThb: "1650000", currentPrice: "60000" },
      "34",
    );
    const t = computeTotals([h1, h2]);
    expect(t.marketValueUsd.toString()).toBe("63600"); // 3600 + 60000
    expect(t.costBasisUsd.toString()).toBe("53000"); // 3000 + 50000
    // base market value = 3600*34 + 60000*34 = 122400 + 2040000 = 2162400
    expect(t.marketValueBase.toString()).toBe("2162400");
  });
});

describe("computeAllocation", () => {
  it("percentages sum to ~100", () => {
    const h1 = valueHolding(base, "34");
    const h2 = valueHolding({ ...base, assetSymbol: "QQQM", quantity: "10" }, "34");
    const slices = computeAllocation([h1, h2], "asset");
    const total = slices.reduce((s, x) => s + x.pct, 0);
    expect(Math.round(total)).toBe(100);
  });
});

describe("aggregateSource", () => {
  it("all live -> live", () => {
    expect(aggregateSource(["finnhub", "coingecko"])).toBe("live");
  });
  it("mixed -> partial", () => {
    expect(aggregateSource(["finnhub", "cache"])).toBe("partial");
  });
  it("all degraded -> mock", () => {
    expect(aggregateSource(["mock", "cache"])).toBe("mock");
  });
  it("empty -> live", () => {
    expect(aggregateSource([])).toBe("live");
  });
});

describe("netDividend (tax drag seam)", () => {
  it("US ETF 15% withholding", () => {
    expect(netDividend("100", "15").toString()).toBe("85");
  });
  it("REIT ~30% withholding", () => {
    expect(netDividend("100", "30").toString()).toBe("70");
  });
});
