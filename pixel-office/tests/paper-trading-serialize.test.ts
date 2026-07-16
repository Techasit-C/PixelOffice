import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { toDecimalString, dailyRealizedPnlString, parseDecimalInput } from "@/lib/paper-trading/serialize";

describe("toDecimalString", () => {
  it("round-trips a Decimal through a string and back to an equal Decimal", () => {
    const original = new Prisma.Decimal("12345.67890123");
    const str = toDecimalString(original);
    expect(new Prisma.Decimal(str).equals(original)).toBe(true);
  });

  it("never uses exponential notation, even for very small values", () => {
    const tiny = new Prisma.Decimal("0.00000001");
    expect(toDecimalString(tiny)).toBe("0.00000001");
  });

  it("pads to 8 decimal places", () => {
    expect(toDecimalString(new Prisma.Decimal("5"))).toBe("5.00000000");
  });

  it("serializes a negative value correctly", () => {
    expect(toDecimalString(new Prisma.Decimal("-1085.75088113"))).toBe("-1085.75088113");
  });
});

describe("dailyRealizedPnlString — always a known value, per design §15", () => {
  it("defaults to 0.00000000 when passed null (no day-state row yet)", () => {
    expect(dailyRealizedPnlString(null)).toBe("0.00000000");
  });

  it("defaults to 0.00000000 when passed undefined", () => {
    expect(dailyRealizedPnlString(undefined)).toBe("0.00000000");
  });

  it("serializes a real value, never substituting the default", () => {
    expect(dailyRealizedPnlString(new Prisma.Decimal("-42.5"))).toBe("-42.50000000");
  });
});

describe("parseDecimalInput", () => {
  it("parses a valid quantity string", () => {
    const result = parseDecimalInput("1.5");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.equals(new Prisma.Decimal("1.5"))).toBe(true);
  });

  it("rejects a quantity with more than 8 fractional digits", () => {
    const result = parseDecimalInput("1.123456789");
    expect(result).toEqual({ ok: false, code: "INVALID_QUANTITY_PRECISION" });
  });

  it("never throws on malformed, non-numeric input", () => {
    expect(() => parseDecimalInput("not-a-number")).not.toThrow();
    expect(parseDecimalInput("not-a-number").ok).toBe(false);
  });
});
