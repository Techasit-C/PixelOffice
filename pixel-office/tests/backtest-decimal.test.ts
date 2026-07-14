import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { D8, Q8, ONE_QUANTITY_QUANTUM, toFixedString } from "@/lib/backtest/decimal";

// Mirrors lib/trading-bot/mock-broker.ts's private `rounded()` helper exactly
// (8dp, ROUND_HALF_UP) — D8 must never diverge from the accepted Phase 1 convention.
function acceptedMonetaryRounding(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}

describe("D8 parity with the accepted Phase 1 monetary rounding convention", () => {
  const fixtures = [
    "1.123456785",
    "0.000000005",
    "100000.999999995",
    "0",
    "-5.123456785",
    "0.123456784",
    "12345.123456786",
  ];

  it("matches lib/trading-bot/mock-broker.ts's rounded() on every shared fixture", () => {
    for (const f of fixtures) {
      expect(toFixedString(D8(f))).toBe(toFixedString(acceptedMonetaryRounding(new Prisma.Decimal(f))));
    }
  });

  it("rounds half up at the 8th decimal place", () => {
    expect(toFixedString(D8("1.000000005"))).toBe("1.00000001");
    expect(toFixedString(D8("1.000000004"))).toBe("1.00000000");
  });
});

describe("Q8 quantity rounding (floor, never up)", () => {
  it("truncates toward zero at 8dp regardless of the 9th digit", () => {
    expect(Q8("1.999999999").toFixed()).toBe("1.99999999");
    expect(Q8("1.999999991").toFixed()).toBe("1.99999999");
  });

  it("floors a sub-quantum value to exactly zero", () => {
    expect(Q8("0.000000001").toFixed()).toBe("0");
  });

  it("never produces a value greater than the unrounded input", () => {
    const input = new Prisma.Decimal("42.123456789123");
    expect(Q8(input).lessThanOrEqualTo(input)).toBe(true);
  });
});

describe("ONE_QUANTITY_QUANTUM", () => {
  it("equals the smallest representable 8dp quantity", () => {
    expect(ONE_QUANTITY_QUANTUM.toFixed()).toBe("0.00000001");
  });
});

describe("toFixedString — always exactly 8 decimal places, never exponential notation", () => {
  it("keeps fixed-point notation for magnitudes where .toString() would switch to exponential", () => {
    const tiny = new Prisma.Decimal("0.00000001");
    expect(tiny.toString()).toBe("1e-8"); // documents the decimal.js behavior being worked around
    expect(toFixedString(tiny)).toBe("0.00000001");
  });

  it("pads to exactly 8 decimal places, unlike bare .toFixed() which strips trailing zeros", () => {
    const whole = new Prisma.Decimal("1");
    expect(whole.toFixed()).toBe("1"); // documents the decimal.js behavior being worked around
    expect(toFixedString(whole)).toBe("1.00000000");
  });

  it("renders zero as '0.00000000', consistent with every other monetary value", () => {
    expect(toFixedString(new Prisma.Decimal(0))).toBe("0.00000000");
  });

  it("does not round further — the value passed in is assumed already D8/Q8-rounded", () => {
    const alreadyRounded = new Prisma.Decimal("42.12345678");
    expect(toFixedString(alreadyRounded)).toBe("42.12345678");
  });
});
