// Re-exports D8 from lib/backtest/decimal.ts — never reimplemented (design §8). Adds
// Phase 4's quantity-precision guard: user-supplied requestedQuantity is REJECTED if it
// has more than 8 fractional digits, never silently rounded (design §5a). Q8 is
// deliberately not used here — Phase 4 never auto-sizes quantity.
import { D8 } from "@/lib/backtest/decimal";
import type { RejectCode } from "./types";

export { D8 };

const MAX_QUANTITY_FRACTIONAL_DIGITS = 8;

export type QuantityPrecisionResult =
  | { ok: true }
  | { ok: false; code: RejectCode };

export function validateQuantityPrecision(raw: string): QuantityPrecisionResult {
  const dotIndex = raw.indexOf(".");
  if (dotIndex === -1) return { ok: true };
  const fractionalDigits = raw.length - dotIndex - 1;
  return fractionalDigits <= MAX_QUANTITY_FRACTIONAL_DIGITS
    ? { ok: true }
    : { ok: false, code: "INVALID_QUANTITY_PRECISION" };
}
