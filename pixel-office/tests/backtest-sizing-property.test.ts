import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { sizeWithinCashAndRisk } from "@/lib/backtest/sizing";
import { CONFIG_BOUNDS, RISK_PER_TRADE_FRACTION } from "@/lib/backtest/config";

// Fixed grid, no randomness/fuzzing library: min/mid/max for each numeric bound,
// combined pairwise (not full cartesian) to keep the suite fast and deterministic.
const SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
const BALANCES = [CONFIG_BOUNDS.initialBalance.min, 50_000, CONFIG_BOUNDS.initialBalance.max];
const FEE_RATES = [CONFIG_BOUNDS.feeRate.min, 0.001, CONFIG_BOUNDS.feeRate.max];
const SPREADS = [CONFIG_BOUNDS.spreadBps.min, 5, CONFIG_BOUNDS.spreadBps.max];
const SLIPPAGES = [CONFIG_BOUNDS.slippageBps.min, 5, CONFIG_BOUNDS.slippageBps.max];
const PRICES = [0.01, 1, 100, 65000]; // representative price magnitudes across the whitelist

function pairwise<A, B>(as: A[], bs: B[]): [A, B][] {
  const out: [A, B][] = [];
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i++) out.push([as[i % as.length], bs[i % bs.length]]);
  return out;
}

describe("sizing property sweep — every accepted quantity satisfies both hard caps", () => {
  const combos = pairwise(BALANCES, FEE_RATES)
    .flatMap(([balance, fee]) => pairwise(SPREADS, SLIPPAGES).map(([spread, slip]) => ({ balance, fee, spread, slip })))
    .flatMap((c) => PRICES.map((price) => ({ ...c, price })));

  it.each(combos)(
    "balance=%o fee=%o spread=%o slippage=%o price=%o: accept implies both constraints hold; reject is always one of the three safe codes",
    ({ balance, fee, spread, slip, price }) => {
      const feeRate = new Prisma.Decimal(fee);
      const availableCash = new Prisma.Decimal(balance);
      const entryExecutionPrice = new Prisma.Decimal(price).times(1 + spread / 20000).times(1 + slip / 10000);
      const stopExecutionPrice = new Prisma.Decimal(price).times(0.98); // a plausible 2%-below stop
      const riskBudget = availableCash.times(RISK_PER_TRADE_FRACTION);
      const initialQuantity = availableCash.dividedBy(entryExecutionPrice.times(feeRate.plus(1))).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);

      const result = sizeWithinCashAndRisk(initialQuantity, entryExecutionPrice, feeRate, availableCash, riskBudget, stopExecutionPrice);

      if (result.ok) {
        expect(result.entryCost.lessThanOrEqualTo(availableCash)).toBe(true);
        expect(result.actualNetRisk === null || result.actualNetRisk.lessThanOrEqualTo(riskBudget)).toBe(true);
      } else {
        expect(["QUANTITY_TOO_SMALL", "INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE", "RISK_BUDGET_UNREPRESENTABLE"]).toContain(result.reason);
      }
    },
  );

  it("every whitelisted symbol is represented in the sweep (documentation check)", () => {
    expect(SYMBOLS).toEqual(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);
  });
});
