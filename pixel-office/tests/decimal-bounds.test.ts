// CR-003 F-03: decimalString bounds — over-precision must fail as a 400-level Zod
// error here, never leak through to a Postgres numeric-overflow 500.
import { describe, it, expect } from "vitest";
import {
  boundedDecimalString,
  quantityDecimal,
  priceDecimal,
  fxRateDecimal,
} from "@/lib/api/schemas";

describe("boundedDecimalString — rejects invalid values (unchanged rules)", () => {
  const s = boundedDecimalString(20, 8);
  it("rejects garbage / NaN / Infinity / negative", () => {
    expect(s.safeParse("abc").success).toBe(false);
    expect(s.safeParse("NaN").success).toBe(false);
    expect(s.safeParse("Infinity").success).toBe(false);
    expect(s.safeParse("-1").success).toBe(false);
    expect(s.safeParse("").success).toBe(false);
  });
  it("accepts a normal non-negative value (string or number)", () => {
    expect(s.safeParse("123.45").success).toBe(true);
    expect(s.safeParse(0).success).toBe(true);
  });
});

describe("quantity Decimal(30,10) — 20 int digits, 10 scale", () => {
  it("accepts exactly 10 decimal places", () => {
    expect(quantityDecimal.safeParse("0.1234567890").success).toBe(true);
  });
  it("rejects 11 decimal places (over scale)", () => {
    expect(quantityDecimal.safeParse("0.12345678901").success).toBe(false);
  });
  it("accepts exactly 20 integer digits", () => {
    expect(quantityDecimal.safeParse("1".repeat(20)).success).toBe(true);
  });
  it("rejects 21 integer digits (overflow)", () => {
    expect(quantityDecimal.safeParse("1".repeat(21)).success).toBe(false);
  });
});

describe("price Decimal(20,8) — 12 int digits, 8 scale", () => {
  it("accepts 8 decimal places", () => {
    expect(priceDecimal.safeParse("123.12345678").success).toBe(true);
  });
  it("rejects 9 decimal places", () => {
    expect(priceDecimal.safeParse("123.123456789").success).toBe(false);
  });
  it("accepts 12 integer digits, rejects 13", () => {
    expect(priceDecimal.safeParse("1".repeat(12)).success).toBe(true);
    expect(priceDecimal.safeParse("1".repeat(13)).success).toBe(false);
  });
});

describe("fxRate Decimal(18,8) — 10 int digits, 8 scale", () => {
  it("accepts 33.12345678", () => {
    expect(fxRateDecimal.safeParse("33.12345678").success).toBe(true);
  });
  it("accepts 10 integer digits, rejects 11", () => {
    expect(fxRateDecimal.safeParse("1".repeat(10)).success).toBe(true);
    expect(fxRateDecimal.safeParse("1".repeat(11)).success).toBe(false);
  });
});

describe("THB money Decimal(20,2) — 2 scale", () => {
  const thb = boundedDecimalString(20, 2);
  it("accepts 2 decimals, rejects 3", () => {
    expect(thb.safeParse("100.99").success).toBe(true);
    expect(thb.safeParse("100.999").success).toBe(false);
  });
  it("accepts 18 integer digits, rejects 19", () => {
    expect(thb.safeParse("1".repeat(18)).success).toBe(true);
    expect(thb.safeParse("1".repeat(19)).success).toBe(false);
  });
});
