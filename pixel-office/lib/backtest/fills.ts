// Spread/slippage execution-price formulas and exit-trigger detection. spreadBps and
// slippageBps stay two permanently separate config inputs — they are compounded into
// one effective adverse execution price per fill here, never represented as a single
// blended value upstream. Pure, deterministic, no I/O.
import { Prisma } from "@prisma/client";
import { D8 } from "./decimal";

export function askPrice(rawMid: number, spreadBps: number, slippageBps: number): Prisma.Decimal {
  return D8(
    new Prisma.Decimal(rawMid).times(1 + spreadBps / 20000).times(1 + slippageBps / 10000),
  );
}

export function bidPrice(rawMid: number, spreadBps: number, slippageBps: number): Prisma.Decimal {
  return D8(
    new Prisma.Decimal(rawMid).times(1 - spreadBps / 20000).times(1 - slippageBps / 10000),
  );
}

export type ExitTrigger = "STOP" | "TP1" | "NONE";

/** Stop-first, unconditionally, when both levels are touched in the same bar. */
export function detectExitTrigger(barLow: number, barHigh: number, stopLoss: number, tp1: number): ExitTrigger {
  if (barLow <= stopLoss) return "STOP";
  if (barHigh >= tp1) return "TP1";
  return "NONE";
}

/** Open-based gap-through fill — fills at the bar's raw open, not the stale level. */
export function gapExitRawMid(
  barOpen: number,
  stopLoss: number,
  tp1: number,
): { trigger: Exclude<ExitTrigger, "NONE">; rawMid: number } | null {
  if (barOpen <= stopLoss) return { trigger: "STOP", rawMid: barOpen };
  if (barOpen >= tp1) return { trigger: "TP1", rawMid: barOpen };
  return null;
}

export interface ExitAccounting {
  exitExecutionPrice: Prisma.Decimal;
  exitNotional: Prisma.Decimal;
  exitFee: Prisma.Decimal;
  exitProceeds: Prisma.Decimal;
  realizedPnl: Prisma.Decimal;
}

/** Total-notional exit accounting — used for STOP, TP1, and END_OF_TEST exits alike. */
export function computeExit(
  rawMid: number,
  spreadBps: number,
  slippageBps: number,
  feeRate: Prisma.Decimal,
  quantity: Prisma.Decimal,
  entryCost: Prisma.Decimal,
): ExitAccounting {
  const exitExecutionPrice = bidPrice(rawMid, spreadBps, slippageBps);
  const exitNotional = D8(quantity.times(exitExecutionPrice));
  const exitFee = D8(exitNotional.times(feeRate));
  const exitProceeds = D8(exitNotional.minus(exitFee));
  const realizedPnl = D8(exitProceeds.minus(entryCost));
  return { exitExecutionPrice, exitNotional, exitFee, exitProceeds, realizedPnl };
}
