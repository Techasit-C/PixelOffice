// Phase 4 domain types — pure, no I/O. See docs/superpowers/specs/
// 2026-07-17-trading-bot-phase4-persistent-paper-trading-design.md §11/§12/§7/§13.
//
// REJECT_CODES is the single source of truth: RejectCode is derived from it, so the
// runtime array and the compile-time union can never drift apart.
export const REJECT_CODES = [
  "GENERATION_MISMATCH",
  "EMERGENCY_STOP_ACTIVE",
  "STALE_CANDLE_DATA",
  "RISK_UNCONFIRMED",
  "NON_POSITIVE_EQUITY",
  "MISSING_STOP_LOSS",
  "INVALID_STOP_LOSS",
  "POSITION_ALREADY_OPEN",
  "MAX_RISK_PER_TRADE",
  "MAX_POSITION_SIZE",
  "MAX_TOTAL_EXPOSURE",
  "MAX_OPEN_POSITIONS",
  "DAILY_LOSS_LIMIT",
  "MAX_DRAWDOWN",
  "MAX_ORDER_FREQUENCY",
  "COOLDOWN_ACTIVE",
  "INSUFFICIENT_FUNDS",
  "NO_OPEN_POSITION",
  "INSUFFICIENT_POSITION",
  "INVALID_QUANTITY_PRECISION",
  "PROVIDER_UNAVAILABLE",
] as const;

export type RejectCode = (typeof REJECT_CODES)[number];

/** Mirrors the Prisma `CommandType` enum as a plain TS union for I/O-free code. */
export type CommandType = "RESET" | "EMERGENCY_STOP_ACTIVATE" | "EMERGENCY_STOP_RESUME";

/** Mirrors the Prisma `SnapshotCompleteness` enum. */
export type SnapshotCompleteness = "COMPLETE" | "PARTIAL";

/** Mirrors the Prisma `PaperOrderSide` enum. */
export type PaperOrderSide = "BUY" | "SELL";

/** Mirrors the Prisma `PaperOrderStatus` enum. */
export type PaperOrderStatus = "FILLED" | "REJECTED";
