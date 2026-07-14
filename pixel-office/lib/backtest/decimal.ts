// The ONLY rounding/serialization operations used anywhere in lib/backtest/. D8 is
// used for every price/fee/cash/notional/P&L value; Q8 is used ONLY for quantity, and
// only ever floors — a floored quantity's cost can never exceed the budget it was
// sized from. D8 is verified (tests/backtest-decimal.test.ts) to match the accepted
// Phase 1 monetary rounding convention in lib/trading-bot/mock-broker.ts's rounded()
// helper, without importing lib/trading-bot (kept out of lib/backtest/'s import graph).
//
// toFixedString MUST be used (never raw .toString()) whenever a Decimal becomes a
// persisted/serialized string (ledger fields, JSON response, CSV) — decimal.js's
// .toString() switches to exponential notation ("1e-8") for magnitudes at/below the
// 8-decimal quantity floor, which would corrupt fixed-point serialization. .toFixed()
// (no arguments) never does this; it always returns fixed-point notation.
import { Prisma } from "@prisma/client";

export function D8(x: Prisma.Decimal | number | string): Prisma.Decimal {
  return new Prisma.Decimal(x).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}

export function Q8(x: Prisma.Decimal | number | string): Prisma.Decimal {
  return new Prisma.Decimal(x).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
}

export const ONE_QUANTITY_QUANTUM = new Prisma.Decimal("0.00000001");

export function toFixedString(d: Prisma.Decimal): string {
  return d.toFixed(8);
}
