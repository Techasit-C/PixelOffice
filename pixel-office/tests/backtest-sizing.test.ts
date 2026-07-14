import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { sizeWithinCashAndRisk } from "@/lib/backtest/sizing";

const feeRate = new Prisma.Decimal("0.001");

describe("sizeWithinCashAndRisk — accepts when both constraints hold", () => {
  it("accepts the initial quantity untouched when cash and risk are both ample", () => {
    const result = sizeWithinCashAndRisk(
      new Prisma.Decimal("1"), new Prisma.Decimal("100"), feeRate,
      new Prisma.Decimal("10000"), new Prisma.Decimal("500"), new Prisma.Decimal("90"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quantity.toString()).toBe("1");
      expect(result.entryCost.lessThanOrEqualTo("10000")).toBe(true);
      expect(result.actualNetRisk!.lessThanOrEqualTo("500")).toBe(true);
    }
  });
});

describe("sizeWithinCashAndRisk — cash boundary (rounding pushes cost over)", () => {
  it("decrements until entryCost <= availableCash exactly, when rounding pushes cost just over", () => {
    // Choose a price where the unrounded cost is just at the boundary, but D8's
    // ROUND_HALF_UP rounding of the fee tips the rounded cost slightly over.
    const price = new Prisma.Decimal("100.000000005");
    const quantity = new Prisma.Decimal("1");
    const notional = quantity.times(price);
    const fee = notional.times(feeRate);
    const trueCost = notional.plus(fee);
    const availableCash = trueCost.toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);

    const result = sizeWithinCashAndRisk(quantity, price, feeRate, availableCash, null, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entryCost.lessThanOrEqualTo(availableCash)).toBe(true);
    }
  });

  it("rejects QUANTITY_TOO_SMALL when the initial quantity is already exactly one quantum and unaffordable", () => {
    const result = sizeWithinCashAndRisk(
      new Prisma.Decimal("0.00000001"), new Prisma.Decimal("1000000"), feeRate,
      new Prisma.Decimal("0.001"), null, null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("QUANTITY_TOO_SMALL");
  });

  it("rejects INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE when the loop exhausts all 8 steps still cash-constrained", () => {
    // 9 quanta at a price where even 1 quantum costs more than availableCash: the loop
    // decrements 8 times (steps 0-7), ending at 1 quantum (still > 0) without ever
    // affording it, so it exhausts rather than hitting the QUANTITY_TOO_SMALL branch.
    const result = sizeWithinCashAndRisk(
      new Prisma.Decimal("0.00000009"), new Prisma.Decimal("1000000"), new Prisma.Decimal("0"),
      new Prisma.Decimal("0.001"), null, null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE");
  });
});

describe("sizeWithinCashAndRisk — risk-budget boundary (rounding pushes risk over)", () => {
  it("decrements until actualNetRisk <= riskBudget exactly, with no tolerance applied", () => {
    // feeRate=0 isolates the risk-boundary arithmetic. quantity=100 @ entry=100/stop=99
    // produces actualNetRisk=100 exactly. riskBudget is set to exactly one quantity
    // quantum's risk below that (99.99999999), so quantity=100 fails, and after
    // exactly one decrement (to 99.99999999) actualNetRisk recomputes to precisely
    // 99.99999999, satisfying the budget with no tolerance.
    const entryPrice = new Prisma.Decimal("100");
    const stopPrice = new Prisma.Decimal("99");
    const quantity = new Prisma.Decimal("100");
    const zeroFee = new Prisma.Decimal("0");
    const riskBudget = new Prisma.Decimal("99.99999999");

    const result = sizeWithinCashAndRisk(
      quantity, entryPrice, zeroFee, new Prisma.Decimal("1000000"), riskBudget, stopPrice,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quantity.toString()).toBe("99.99999999");
      expect(result.actualNetRisk!.lessThanOrEqualTo(riskBudget)).toBe(true);
    }
  });

  it("rejects RISK_BUDGET_UNREPRESENTABLE when cash is ample but risk cannot be satisfied within 8 steps", () => {
    const result = sizeWithinCashAndRisk(
      new Prisma.Decimal("1"), new Prisma.Decimal("100"), feeRate,
      new Prisma.Decimal("1000000"), new Prisma.Decimal("0.00000001"), new Prisma.Decimal("0"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("RISK_BUDGET_UNREPRESENTABLE");
  });
});

describe("sizeWithinCashAndRisk — cash-only mode (benchmark, riskBudget=null)", () => {
  it("ignores risk entirely and only enforces cash affordability", () => {
    const result = sizeWithinCashAndRisk(
      new Prisma.Decimal("50"), new Prisma.Decimal("100"), feeRate,
      new Prisma.Decimal("5100"), null, null, // headroom above the 5000 notional for the 0.1% fee
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actualNetRisk).toBeNull();
  });
});
