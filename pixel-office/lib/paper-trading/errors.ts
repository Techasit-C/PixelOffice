import type { RejectCode } from "./types";

// Record<RejectCode, string> makes TypeScript itself enforce exhaustiveness — every
// code in REJECT_CODES must appear here exactly once, and no extra key is permitted.
const DEFAULT_REASONS: Record<RejectCode, string> = {
  GENERATION_MISMATCH: "This request targets an account generation that is no longer active.",
  EMERGENCY_STOP_ACTIVE: "Emergency Stop is active — new positions cannot be opened.",
  STALE_CANDLE_DATA: "Market data is currently stale or unavailable.",
  RISK_UNCONFIRMED: "Account or market state could not be confirmed reliably.",
  NON_POSITIVE_EQUITY: "Account equity must be greater than zero to open a new position.",
  MISSING_STOP_LOSS: "The signal has no stop-loss; cannot size the order.",
  INVALID_STOP_LOSS: "Stop-loss must be a positive price strictly below the entry execution price.",
  POSITION_ALREADY_OPEN: "A position is already open for this symbol — averaging in is not permitted.",
  MAX_RISK_PER_TRADE: "This order's risk exceeds the maximum allowed risk per trade.",
  MAX_POSITION_SIZE: "This order would exceed the maximum position size.",
  MAX_TOTAL_EXPOSURE: "This order would exceed the maximum total exposure.",
  MAX_OPEN_POSITIONS: "The maximum number of open positions has been reached.",
  DAILY_LOSS_LIMIT: "The daily realized-loss limit has been reached.",
  MAX_DRAWDOWN: "The maximum observed drawdown has been reached.",
  MAX_ORDER_FREQUENCY: "The maximum number of opening orders in the current window has been reached.",
  COOLDOWN_ACTIVE: "A cooldown is active after consecutive losing closes.",
  INSUFFICIENT_FUNDS: "Order notional plus fee exceeds available cash balance.",
  NO_OPEN_POSITION: "No open position for this symbol.",
  INSUFFICIENT_POSITION: "Requested quantity exceeds the held position.",
  INVALID_QUANTITY_PRECISION: "Quantity must have at most 8 fractional digits.",
  PROVIDER_UNAVAILABLE: "Market data could not be fetched in time — no order was placed.",
};

export function defaultReason(code: RejectCode): string {
  return DEFAULT_REASONS[code];
}
