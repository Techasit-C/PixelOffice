// Decimal-string API-boundary serialization (design §15). toDecimalString never emits
// exponential notation — the same rationale as lib/backtest/decimal.ts's toFixedString:
// decimal.js's bare .toString() switches to exponential notation for small magnitudes,
// which would corrupt a fixed-point API contract. .toFixed(dp) never does that.
import { Prisma } from "@prisma/client";
import { validateQuantityPrecision } from "./decimal";
import type { RejectCode } from "./types";

const DECIMAL_PLACES = 8;

export function toDecimalString(d: Prisma.Decimal, dp: number = DECIMAL_PLACES): string {
  return d.toFixed(dp);
}

/**
 * dailyRealizedPnl is always a known, persisted value (design §15) — it is derived
 * purely from committed SELL fills, never from live market valuation. It defaults to
 * "0.00000000" when no PaperRiskDayState row exists yet for today, never null.
 */
export function dailyRealizedPnlString(d: Prisma.Decimal | null | undefined): string {
  return toDecimalString(d ?? new Prisma.Decimal(0));
}

export type ParseDecimalInputResult =
  | { ok: true; value: Prisma.Decimal }
  | { ok: false; code: RejectCode };

/**
 * Parses a request-supplied decimal string. Delegates precision validation to
 * validateQuantityPrecision (rejects, never rounds, anything with >8 fractional
 * digits). Never throws on malformed non-numeric input — degrades to a controlled
 * rejection instead of letting Prisma.Decimal's constructor crash the caller.
 */
export function parseDecimalInput(raw: string): ParseDecimalInputResult {
  const precision = validateQuantityPrecision(raw);
  if (!precision.ok) return precision;
  try {
    return { ok: true, value: new Prisma.Decimal(raw) };
  } catch {
    return { ok: false, code: "INVALID_QUANTITY_PRECISION" };
  }
}
