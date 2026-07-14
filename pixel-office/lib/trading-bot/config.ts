// Phase 1 constants — named, not inlined, so later phases can change them
// without touching execution logic. All monetary values are in USDT.
import { Prisma } from "@prisma/client";

export const PAPER_STARTING_BALANCE_USDT = new Prisma.Decimal("10000.00");

/** 0.1% flat fee, applied identically to BUY notional and SELL proceeds. */
export const MOCK_FEE_RATE = new Prisma.Decimal("0.001");

/** Max age of the signal INSTANCE the user acted on (observedGeneratedAt). */
export const SIGNAL_FRESHNESS_WINDOW_MS = 5 * 60_000;
