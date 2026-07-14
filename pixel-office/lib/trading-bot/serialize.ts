import { Prisma } from "@prisma/client";
import { z } from "zod";

const QUANTITY_PATTERN = /^\d{1,18}(\.\d{1,10})?$/;

export class InvalidQuantityError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidQuantityError";
  }
}

/** Strict: only a plain decimal string (no numbers, no exponents, no signs). */
export function parseQuantityInput(raw: unknown): Prisma.Decimal {
  if (typeof raw !== "string") {
    throw new InvalidQuantityError("quantity must be a string");
  }
  if (!QUANTITY_PATTERN.test(raw)) {
    throw new InvalidQuantityError(
      "quantity must be a positive decimal string with at most 10 decimal places",
    );
  }
  const d = new Prisma.Decimal(raw);
  if (!d.isFinite() || d.isNegative() || d.isZero()) {
    throw new InvalidQuantityError("quantity must be a positive finite number");
  }
  return d;
}

/** Zod schema wrapper so routes can validate quantity inline in a larger object. */
export const quantityInputSchema = z.string().superRefine((val, ctx) => {
  try {
    parseQuantityInput(val);
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: err instanceof Error ? err.message : "invalid quantity",
    });
  }
});

/** Exact, no implicit rounding — rounding happens earlier, at computation time. */
export function toDecimalString(d: Prisma.Decimal): string {
  return d.toString();
}

export function roundMoney(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}
