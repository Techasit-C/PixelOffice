// Deterministic Phase 3 constants, copied verbatim from the approved design spec
// (docs/superpowers/specs/2026-07-15-trading-bot-phase3-backtesting-design.md §2/§2.1).
// MAX_AFFORDABILITY_ADJUST_STEPS must not change without separate explicit approval.
import { Prisma } from "@prisma/client";

export const RISK_PER_TRADE_FRACTION = new Prisma.Decimal("0.005");
export const PRIMARY_WARMUP_BARS = 60;
export const CONFIRMATION_WARMUP_BARS = 50;
export const MAX_AFFORDABILITY_ADJUST_STEPS = 8;
export const MIN_QUANTITY = new Prisma.Decimal("0.00000001");

export const DEFAULT_SPREAD_BPS = 5;
export const DEFAULT_SLIPPAGE_BPS = 5;
export const DEFAULT_FEE_RATE = new Prisma.Decimal("0.001");
export const DEFAULT_INITIAL_BALANCE = new Prisma.Decimal("10000");

export const MAX_REQUESTED_RANGE_DAYS = 365;

export const CONFIG_BOUNDS = {
  initialBalance: { min: 100, max: 1_000_000 },
  feeRate: { min: 0, max: 0.01 },
  spreadBps: { min: 0, max: 100 },
  slippageBps: { min: 0, max: 100 },
} as const;
