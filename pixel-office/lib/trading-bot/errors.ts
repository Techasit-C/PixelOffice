import type { RejectCode } from "./types";

const DEFAULT_REASONS: Record<RejectCode, string> = {
  UNRECOGNIZED_SIGNAL: "Unknown symbol or timeframe.",
  NON_ACTIONABLE_SIGNAL: "The current signal is WAIT — no actionable setup.",
  UNSUPPORTED_SHORT: "SHORT signals are not supported in Phase 1 (long-only).",
  STALE_SIGNAL: "The signal you viewed has expired — refresh and try again.",
  STALE_CANDLE_DATA: "Market data is currently stale or unavailable.",
  INVALID_QUANTITY: "Quantity must be a positive decimal string.",
  MISSING_STOP_LOSS: "The signal has no stop-loss; cannot size the order.",
  INSUFFICIENT_FUNDS: "Order notional plus fee exceeds available cash balance.",
  INSUFFICIENT_POSITION: "Requested quantity exceeds the held position.",
  NO_OPEN_POSITION: "No open position for this symbol.",
};

export function defaultReason(code: RejectCode): string {
  return DEFAULT_REASONS[code];
}
