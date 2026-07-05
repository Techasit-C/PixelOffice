import { describe, it, expect } from "vitest";
import {
  AverageCostStrategy,
  InsufficientQuantityError,
  type CostBasisTx,
} from "@/lib/portfolio/cost-basis";

const strat = new AverageCostStrategy();

function buy(
  qty: string,
  price: string,
  fx: string,
  at: string,
  fees?: string,
): CostBasisTx {
  return {
    type: "BUY",
    quantity: qty,
    executedPrice: price,
    currency: "USD",
    fxRateUsdThb: fx,
    fees,
    executedAt: new Date(at),
  };
}
function sell(qty: string, price: string, fx: string, at: string, fees?: string): CostBasisTx {
  return {
    type: "SELL",
    quantity: qty,
    executedPrice: price,
    currency: "USD",
    fxRateUsdThb: fx,
    fees,
    executedAt: new Date(at),
  };
}

describe("AverageCostStrategy", () => {
  it("empty portfolio -> all zero", () => {
    const c = strat.compute([]);
    expect(c.quantity.toString()).toBe("0");
    expect(c.avgCostNative.toString()).toBe("0");
    expect(c.avgCostThb.toString()).toBe("0");
    expect(c.realizedPnlNative.toString()).toBe("0");
  });

  it("buys at different prices -> weighted average cost (native + THB)", () => {
    const c = strat.compute([
      buy("10", "100", "33", "2024-01-01"),
      buy("10", "200", "34", "2024-02-01"),
    ]);
    expect(c.quantity.toString()).toBe("20");
    // (1000 + 2000) / 20 = 150
    expect(c.avgCostNative.toString()).toBe("150");
    // (1000*33 + 2000*34) / 20 = 101000/20 = 5050  (THB, from FX snapshots)
    expect(c.avgCostThb.toString()).toBe("5050");
    expect(c.totalCostNative.toString()).toBe("3000");
    expect(c.totalCostThb.toString()).toBe("101000");
  });

  it("sell reduces quantity but NOT average cost; accrues realized P&L", () => {
    const c = strat.compute([
      buy("10", "100", "33", "2024-01-01"),
      buy("10", "200", "34", "2024-02-01"),
      sell("5", "300", "35", "2024-03-01"),
    ]);
    expect(c.quantity.toString()).toBe("15");
    expect(c.avgCostNative.toString()).toBe("150"); // unchanged by the sell
    expect(c.avgCostThb.toString()).toBe("5050"); // unchanged by the sell
    expect(c.totalCostNative.toString()).toBe("2250"); // 150 * 15
    expect(c.totalCostThb.toString()).toBe("75750"); // 5050 * 15
    // realized = (300 - 150) * 5 = 750
    expect(c.realizedPnlNative.toString()).toBe("750");
  });

  it("multi-currency THB basis uses each buy's own immutable FX snapshot", () => {
    // Same native prices, DIFFERENT fx snapshots -> THB basis differs from a naive
    // single-rate calc, proving the per-transaction snapshot is honored.
    const c = strat.compute([
      buy("1", "100", "30", "2024-01-01"),
      buy("1", "100", "40", "2024-02-01"),
    ]);
    expect(c.avgCostNative.toString()).toBe("100");
    // (100*30 + 100*40) / 2 = 7000/2 = 3500 THB per unit
    expect(c.avgCostThb.toString()).toBe("3500");
  });

  it("includes fees in cost basis on BUY", () => {
    const c = strat.compute([buy("10", "100", "33", "2024-01-01", "5")]);
    // (1000 + 5) / 10 = 100.5
    expect(c.avgCostNative.toString()).toBe("100.5");
    // 1005 * 33 / 10 = 3316.5
    expect(c.avgCostThb.toString()).toBe("3316.5");
  });

  it("sell fees reduce realized P&L", () => {
    const c = strat.compute([
      buy("10", "100", "33", "2024-01-01"),
      sell("5", "150", "34", "2024-02-01", "10"),
    ]);
    // (150-100)*5 - 10 = 240
    expect(c.realizedPnlNative.toString()).toBe("240");
  });

  it("DIVIDEND / FEE cash events do not change quantity or average cost", () => {
    const c = strat.compute([
      buy("10", "100", "33", "2024-01-01"),
      { type: "DIVIDEND", quantity: "0", executedPrice: "0", currency: "USD", fxRateUsdThb: "33", executedAt: new Date("2024-02-01") },
      { type: "FEE", quantity: "0", executedPrice: "0", currency: "USD", fxRateUsdThb: "33", executedAt: new Date("2024-03-01") },
    ]);
    expect(c.quantity.toString()).toBe("10");
    expect(c.avgCostNative.toString()).toBe("100");
  });

  it("guards sell-more-than-held", () => {
    expect(() =>
      strat.compute([buy("10", "100", "33", "2024-01-01"), sell("15", "120", "34", "2024-02-01")]),
    ).toThrow(InsufficientQuantityError);
  });

  it("fully closing a position resets average cost so a re-buy starts clean", () => {
    const c = strat.compute([
      buy("10", "100", "33", "2024-01-01"),
      sell("10", "150", "34", "2024-02-01"),
      buy("5", "200", "35", "2024-03-01"),
    ]);
    expect(c.quantity.toString()).toBe("5");
    expect(c.avgCostNative.toString()).toBe("200");
    expect(c.avgCostThb.toString()).toBe("7000"); // 200 * 35
    // realized from the middle sell only: (150-100)*10 = 500
    expect(c.realizedPnlNative.toString()).toBe("500");
  });

  it("sorts by executedAt regardless of input order", () => {
    const c = strat.compute([
      buy("10", "200", "34", "2024-02-01"),
      buy("10", "100", "33", "2024-01-01"),
    ]);
    expect(c.avgCostNative.toString()).toBe("150");
  });
});
