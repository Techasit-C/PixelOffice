import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { D8, validateQuantityPrecision } from "@/lib/paper-trading/decimal";

describe("D8 (re-exported from lib/backtest/decimal, not reimplemented)", () => {
  it("rounds to 8 decimal places with ROUND_HALF_UP", () => {
    expect(D8(new Prisma.Decimal("1.123456789")).toFixed(8)).toBe("1.12345679");
  });
});

describe("validateQuantityPrecision", () => {
  it("accepts a quantity with exactly 8 fractional digits", () => {
    expect(validateQuantityPrecision("1.12345678")).toEqual({ ok: true });
  });

  it("accepts an integer quantity with no decimal point", () => {
    expect(validateQuantityPrecision("5")).toEqual({ ok: true });
  });

  it("accepts a quantity with fewer than 8 fractional digits", () => {
    expect(validateQuantityPrecision("1.5")).toEqual({ ok: true });
  });

  it("rejects a quantity with 9 fractional digits", () => {
    expect(validateQuantityPrecision("1.123456789")).toEqual({
      ok: false,
      code: "INVALID_QUANTITY_PRECISION",
    });
  });

  it("rejects a quantity with many excess fractional digits", () => {
    expect(validateQuantityPrecision("0.100000000001")).toEqual({
      ok: false,
      code: "INVALID_QUANTITY_PRECISION",
    });
  });
});
