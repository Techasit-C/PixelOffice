// Spread/slippage execution-price formulas and exit-trigger detection. spreadBps and
// slippageBps stay two permanently separate config inputs — they are compounded into
// one effective adverse execution price per fill here, never represented as a single
// blended value upstream. Pure, deterministic, no I/O.
import { Prisma } from "@prisma/client";
import { D8, Q8 } from "./decimal";
import { sizeWithinCashAndRisk } from "./sizing";
import { RISK_PER_TRADE_FRACTION } from "./config";
import type { RejectionReason } from "./types";

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

const MIN_RR = 1.5; // matches lib/trading-signals/config.ts's MIN_RR

export interface EntrySignalLevels {
  entryZoneLow: number;
  entryZoneHigh: number;
  stopLoss: number;
  takeProfit1: number;
}

export interface EntryAccept {
  ok: true;
  entryExecutionPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
  entryNotional: Prisma.Decimal;
  entryFee: Prisma.Decimal;
  entryCost: Prisma.Decimal;
  intendedRiskBudget: Prisma.Decimal;
  actualNetRisk: Prisma.Decimal;
  actualRiskFraction: number;
  cashCapped: boolean;
  netRiskReward: number;
}
export interface EntryReject {
  ok: false;
  reason: RejectionReason;
}
export type EntryValidationResult = EntryAccept | EntryReject;

/** Complete entry-validation sequence. Contiguity (GAP_BEFORE_ENTRY) is the caller's
 *  responsibility (simulate.ts) since it concerns bar-index adjacency, not price
 *  levels. */
export function validateAndSizeEntry(
  entryBarOpen: number,
  levels: EntrySignalLevels,
  spreadBps: number,
  slippageBps: number,
  feeRate: Prisma.Decimal,
  availableCash: Prisma.Decimal,
): EntryValidationResult {
  if (entryBarOpen <= levels.stopLoss) return { ok: false, reason: "GAP_THROUGH_STOP" };
  if (entryBarOpen >= levels.takeProfit1) return { ok: false, reason: "GAP_THROUGH_TARGET" };
  if (entryBarOpen < levels.entryZoneLow || entryBarOpen > levels.entryZoneHigh) {
    return { ok: false, reason: "ENTRY_ZONE_MISSED" };
  }

  const entryExecutionPrice = askPrice(entryBarOpen, spreadBps, slippageBps);
  const zoneLow = new Prisma.Decimal(levels.entryZoneLow);
  const zoneHigh = new Prisma.Decimal(levels.entryZoneHigh);
  if (entryExecutionPrice.lessThan(zoneLow) || entryExecutionPrice.greaterThan(zoneHigh)) {
    return { ok: false, reason: "ENTRY_ZONE_MISSED_AFTER_COSTS" };
  }

  const stopLoss = new Prisma.Decimal(levels.stopLoss);
  const tp1 = new Prisma.Decimal(levels.takeProfit1);
  if (!(stopLoss.lessThan(entryExecutionPrice) && entryExecutionPrice.lessThan(tp1))) {
    return { ok: false, reason: "COST_ADJUSTED_ENTRY_INVALID" };
  }

  const hypotheticalStopExecutionPrice = bidPrice(levels.stopLoss, spreadBps, slippageBps);
  const hypotheticalTargetExecutionPrice = bidPrice(levels.takeProfit1, spreadBps, slippageBps);

  const entryFeePerUnitHyp = entryExecutionPrice.times(feeRate);
  const entryCashOutPerUnitHyp = entryExecutionPrice.plus(entryFeePerUnitHyp);
  const stopExitFeePerUnitHyp = hypotheticalStopExecutionPrice.times(feeRate);
  const stopCashInPerUnitHyp = hypotheticalStopExecutionPrice.minus(stopExitFeePerUnitHyp);
  const targetExitFeePerUnitHyp = hypotheticalTargetExecutionPrice.times(feeRate);
  const targetCashInPerUnitHyp = hypotheticalTargetExecutionPrice.minus(targetExitFeePerUnitHyp);

  const netRiskPerUnitHyp = entryCashOutPerUnitHyp.minus(stopCashInPerUnitHyp);
  const netRewardPerUnitHyp = targetCashInPerUnitHyp.minus(entryCashOutPerUnitHyp);

  if (!netRiskPerUnitHyp.greaterThan(0)) return { ok: false, reason: "NON_POSITIVE_NET_RISK" };
  if (!netRewardPerUnitHyp.greaterThan(0)) return { ok: false, reason: "NON_POSITIVE_NET_REWARD" };

  const netRiskReward = netRewardPerUnitHyp.dividedBy(netRiskPerUnitHyp).toNumber();
  if (netRiskReward < MIN_RR) return { ok: false, reason: "REALIZED_RR_BELOW_MINIMUM" };

  const entryTimeEquity = availableCash;
  const riskBudget = D8(entryTimeEquity.times(RISK_PER_TRADE_FRACTION));
  const riskSizedQuantity = Q8(riskBudget.dividedBy(netRiskPerUnitHyp));
  const cashAffordableQuantity = Q8(availableCash.dividedBy(entryExecutionPrice.times(feeRate.plus(1))));
  const initialQuantity = Prisma.Decimal.min(riskSizedQuantity, cashAffordableQuantity);
  const cashCapped = cashAffordableQuantity.lessThan(riskSizedQuantity);

  const sizing = sizeWithinCashAndRisk(
    initialQuantity, entryExecutionPrice, feeRate, availableCash, riskBudget, hypotheticalStopExecutionPrice,
  );
  if (!sizing.ok) return { ok: false, reason: sizing.reason };

  return {
    ok: true,
    entryExecutionPrice,
    quantity: sizing.quantity,
    entryNotional: sizing.entryNotional,
    entryFee: sizing.entryFee,
    entryCost: sizing.entryCost,
    intendedRiskBudget: riskBudget,
    actualNetRisk: sizing.actualNetRisk!,
    actualRiskFraction: sizing.actualNetRisk!.dividedBy(entryTimeEquity).toNumber(),
    cashCapped,
    netRiskReward,
  };
}
