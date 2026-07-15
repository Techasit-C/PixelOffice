// Client-side mirror of the backtest API route's validation rules (app/api/trading-bot/
// backtest/route.ts): symbol allowlist, the 1-365 day range, start-before-end, and the
// CONFIG_BOUNDS numeric bounds. Pure, no DOM, no React — safe to unit-test directly and
// safe to import from a "use client" component (zero Prisma/Decimal dependency, see
// client-config.ts). Client-side validation is a UX convenience only: the server
// re-validates every field independently and remains the authoritative gate.
import { SUPPORTED_SYMBOLS } from "@/lib/trading-signals/config";
import { CONFIG_BOUNDS, MAX_REQUESTED_RANGE_DAYS } from "./client-config";

const ONE_DAY_MS = 86_400_000;

export interface BacktestFormInput {
  symbol: string;
  start: string; // <input type="date"> value, e.g. "2024-01-01"
  end: string;
  initialBalance: string;
  feeRate: string;
  spreadBps: string;
  slippageBps: string;
}

// Ordered to match the form's visual field order — the first key in this order with
// an error is the field that receives focus.
export const FIELD_ORDER = [
  "symbol", "start", "end", "initialBalance", "feeRate", "spreadBps", "slippageBps",
] as const;
export type FieldName = (typeof FIELD_ORDER)[number];

export type FieldErrors = Partial<Record<FieldName, string>>;

export interface ValidationResult {
  ok: boolean;
  errors: FieldErrors;
  firstInvalidField: FieldName | null;
  /** Only populated when ok:true — the parsed, request-ready values. */
  parsed: {
    requestedStart: number;
    requestedEnd: number;
    initialBalance: number;
    feeRate: number;
    spreadBps: number;
    slippageBps: number;
  } | null;
}

function boundsError(label: string, value: number, min: number, max: number): string | null {
  if (!Number.isFinite(value)) return `${label} must be a number.`;
  if (value < min || value > max) return `${label} must be between ${min} and ${max}.`;
  return null;
}

export function validateBacktestRequestInput(input: BacktestFormInput): ValidationResult {
  const errors: FieldErrors = {};

  if (!SUPPORTED_SYMBOLS.includes(input.symbol)) {
    errors.symbol = "Select a supported symbol.";
  }

  const requestedStart = Date.parse(input.start);
  const requestedEnd = Date.parse(input.end);
  if (!input.start || !Number.isFinite(requestedStart)) {
    errors.start = "Enter a valid start date.";
  }
  if (!input.end || !Number.isFinite(requestedEnd)) {
    errors.end = "Enter a valid end date.";
  }
  if (!errors.start && !errors.end) {
    if (requestedEnd <= requestedStart) {
      errors.end = "End date must be after the start date.";
    } else {
      const rangeDays = (requestedEnd - requestedStart) / ONE_DAY_MS;
      if (rangeDays < 1) {
        errors.end = "Range must be at least 1 day.";
      } else if (rangeDays > MAX_REQUESTED_RANGE_DAYS) {
        errors.end = `Range must be at most ${MAX_REQUESTED_RANGE_DAYS} days.`;
      }
    }
  }

  const initialBalance = Number(input.initialBalance);
  const initialBalanceError = boundsError(
    "Initial balance", initialBalance, CONFIG_BOUNDS.initialBalance.min, CONFIG_BOUNDS.initialBalance.max,
  );
  if (initialBalanceError) errors.initialBalance = initialBalanceError;

  const feeRate = Number(input.feeRate);
  const feeRateError = boundsError("Fee rate", feeRate, CONFIG_BOUNDS.feeRate.min, CONFIG_BOUNDS.feeRate.max);
  if (feeRateError) errors.feeRate = feeRateError;

  const spreadBps = Number(input.spreadBps);
  const spreadBpsError = boundsError("Spread (bps)", spreadBps, CONFIG_BOUNDS.spreadBps.min, CONFIG_BOUNDS.spreadBps.max);
  if (spreadBpsError) errors.spreadBps = spreadBpsError;

  const slippageBps = Number(input.slippageBps);
  const slippageBpsError = boundsError(
    "Slippage (bps)", slippageBps, CONFIG_BOUNDS.slippageBps.min, CONFIG_BOUNDS.slippageBps.max,
  );
  if (slippageBpsError) errors.slippageBps = slippageBpsError;

  const firstInvalidField = FIELD_ORDER.find((f) => errors[f] !== undefined) ?? null;
  const ok = firstInvalidField === null;

  return {
    ok,
    errors,
    firstInvalidField,
    parsed: ok ? { requestedStart, requestedEnd, initialBalance, feeRate, spreadBps, slippageBps } : null,
  };
}
