// Phase 4 constants — matching the already-accepted Phase 1/Phase 3 defaults exactly
// (design §5.1). All monetary values use Prisma.Decimal, never a JS number.
import { Prisma } from "@prisma/client";

export const PAPER_STARTING_BALANCE = new Prisma.Decimal("10000.00000000");

/** 0.1% flat fee, matching lib/trading-bot/config.ts's MOCK_FEE_RATE. */
export const PAPER_FEE_RATE = new Prisma.Decimal("0.001");

/** Matches lib/backtest/config.ts's DEFAULT_SPREAD_BPS/DEFAULT_SLIPPAGE_BPS. */
export const PAPER_SPREAD_BPS = 5;
export const PAPER_SLIPPAGE_BPS = 5;

export const DEFAULT_RISK_PROFILE = {
  maxRiskPerTradePct: new Prisma.Decimal("0.5"),
  maxPositionSizePct: new Prisma.Decimal("20"),
  maxTotalExposurePct: new Prisma.Decimal("50"),
  maxOpenPositions: 3,
  dailyLossLimitPct: new Prisma.Decimal("2"),
  maxDrawdownPct: new Prisma.Decimal("10"),
  maxOrdersPerWindow: 5,
  orderWindowMinutes: 60,
  cooldownAfterLosses: 3,
  cooldownMinutes: 60,
} as const;
