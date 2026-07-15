// Client-safe subset of lib/backtest/config.ts: plain JS constants only, ZERO
// imports. lib/backtest/config.ts re-exports these rather than duplicating them, so
// there is exactly one source of truth for the numeric/range bounds the client-side
// form validator and the server-side API route both enforce. Everything else in
// config.ts (Prisma.Decimal-based defaults) stays server-only and must never be
// imported from a "use client" component — importing @prisma/client into the browser
// bundle breaks the build.
export const MAX_REQUESTED_RANGE_DAYS = 365;

export const CONFIG_BOUNDS = {
  initialBalance: { min: 100, max: 1_000_000 },
  feeRate: { min: 0, max: 0.01 },
  spreadBps: { min: 0, max: 100 },
  slippageBps: { min: 0, max: 100 },
} as const;
