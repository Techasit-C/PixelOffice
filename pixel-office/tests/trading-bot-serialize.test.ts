import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { parseQuantityInput, InvalidQuantityError, toDecimalString, roundMoney } from "@/lib/trading-bot/serialize";

describe("parseQuantityInput", () => {
  it("accepts a valid positive decimal string", () => {
    const d = parseQuantityInput("0.0500000000");
    expect(d.toString()).toBe("0.05");
  });

  it("accepts an integer string", () => {
    expect(parseQuantityInput("5").toString()).toBe("5");
  });

  it.each([
    ["number instead of string", 5],
    ["negative", "-1"],
    ["zero", "0"],
    ["NaN literal", "NaN"],
    ["Infinity literal", "Infinity"],
    ["exponential notation", "1e5"],
    ["multiple decimal points", "1.2.3"],
    ["empty string", ""],
    ["over-precision (11dp)", "1.12345678901"],
    ["null", null],
    ["object", { amount: "5" }],
    ["leading plus sign", "+5"],
  ])("rejects: %s", (_label, raw) => {
    expect(() => parseQuantityInput(raw)).toThrow(InvalidQuantityError);
  });
});

describe("toDecimalString", () => {
  it("round-trips exactly, no implicit rounding", () => {
    const d = new Prisma.Decimal("123.45000000");
    expect(toDecimalString(d)).toBe("123.45");
  });
});

describe("roundMoney", () => {
  it("rounds to 8dp with ROUND_HALF_UP", () => {
    const d = new Prisma.Decimal("1.123456785");
    expect(roundMoney(d).toString()).toBe("1.12345679");
  });
});
