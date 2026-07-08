// Money helpers. ALL portfolio math uses Prisma.Decimal (decimal.js under the
// hood) — never JS `number`. Serialization to `number` happens only for ratios
// that are inherently presentational (allocation %, P&L %), never for amounts.
import { Prisma } from "@prisma/client";

export type Decimal = Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

export type DecimalInput = Prisma.Decimal | string | number | null | undefined;

/** Coerce anything money-shaped to Decimal. null/undefined -> 0. Floats via string. */
export function D(v: DecimalInput): Decimal {
  if (v === null || v === undefined) return new Prisma.Decimal(0);
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(typeof v === "number" ? v.toString() : v);
}

/** Sum a list of Decimals. */
export function sum(values: Decimal[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Prisma.Decimal(0));
}

/** Serialize a Decimal to a string at the API boundary (avoids JS float on wire). */
export function toStr(v: Decimal): string {
  return v.toString();
}

/**
 * A ratio (e.g. pnl/cost) as a rounded number for display only. Guards divide-by-
 * zero -> 0. `dp` decimal places (default 2). Numbers are OK here: this is a
 * presentation percentage, not a money amount.
 */
export function ratioPct(numerator: Decimal, denominator: Decimal, dp = 2): number {
  if (denominator.isZero()) return 0;
  return Number(numerator.div(denominator).times(100).toFixed(dp));
}
