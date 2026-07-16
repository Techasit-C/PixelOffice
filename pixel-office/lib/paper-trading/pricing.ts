// Canonical Phase 4 pricing and cost-basis formulas (design §8/§9). Re-exports
// askPrice/bidPrice from lib/backtest/fills.ts — never reimplemented — so pre-trade risk
// estimation and actual fill accounting share the exact same functions and can never
// drift or double-count spread/slippage/fee costs.
//
// Notional always uses the adverse execution price (ask for entry, bid for exit), never
// the raw reference mark. Position/exposure valuation (newPositionLiquidationValue) uses
// bid — the same convention as every other exposure computation in the design — never the
// ask-based entryNotional, which is reserved exclusively for cash/fee/cost-basis
// accounting (design §9).
import { Prisma } from "@prisma/client";
import { askPrice, bidPrice } from "@/lib/backtest/fills";
import { D8 } from "./decimal";

export { askPrice, bidPrice };

export function entryExecutionPrice(
  referenceMark: number,
  spreadBps: number,
  slippageBps: number,
): Prisma.Decimal {
  return askPrice(referenceMark, spreadBps, slippageBps);
}

export function exitExecutionPrice(
  referenceMark: number,
  spreadBps: number,
  slippageBps: number,
): Prisma.Decimal {
  return bidPrice(referenceMark, spreadBps, slippageBps);
}

export function entryNotional(quantity: Prisma.Decimal, executionPrice: Prisma.Decimal): Prisma.Decimal {
  return D8(quantity.times(executionPrice));
}

export function entryFee(notional: Prisma.Decimal, feeRate: Prisma.Decimal): Prisma.Decimal {
  return D8(notional.times(feeRate));
}

export function entryCost(notional: Prisma.Decimal, fee: Prisma.Decimal): Prisma.Decimal {
  return D8(notional.plus(fee));
}

/** Bid-based — exposure/position-size LIMITS only, never cash/fee/cost-basis accounting. */
export function newPositionLiquidationValue(
  quantity: Prisma.Decimal,
  referenceMark: number,
  spreadBps: number,
  slippageBps: number,
): Prisma.Decimal {
  return D8(quantity.times(bidPrice(referenceMark, spreadBps, slippageBps)));
}

export function exitNotional(quantity: Prisma.Decimal, executionPrice: Prisma.Decimal): Prisma.Decimal {
  return D8(quantity.times(executionPrice));
}

export function exitFee(notional: Prisma.Decimal, feeRate: Prisma.Decimal): Prisma.Decimal {
  return D8(notional.times(feeRate));
}

export function exitProceeds(notional: Prisma.Decimal, fee: Prisma.Decimal): Prisma.Decimal {
  return D8(notional.minus(fee));
}

/** Partial close: proportional allocation. */
export function allocatedCostBasisPartial(
  previousCostBasis: Prisma.Decimal,
  closedQuantity: Prisma.Decimal,
  previousQuantity: Prisma.Decimal,
): Prisma.Decimal {
  return D8(previousCostBasis.times(closedQuantity).dividedBy(previousQuantity));
}

/** Full close: exact assignment, never the ratio formula — guarantees zero rounding dust. */
export function allocatedCostBasisFull(previousCostBasis: Prisma.Decimal): Prisma.Decimal {
  return previousCostBasis;
}

export function realizedPnl(proceeds: Prisma.Decimal, allocatedCostBasis: Prisma.Decimal): Prisma.Decimal {
  return D8(proceeds.minus(allocatedCostBasis));
}

export function remainingCostBasis(
  previousCostBasis: Prisma.Decimal,
  allocatedCostBasis: Prisma.Decimal,
): Prisma.Decimal {
  return D8(previousCostBasis.minus(allocatedCostBasis));
}

/** max(0, entryCost - netExitProceedsAtStop) — never negative. */
export function riskAmount(entryCostValue: Prisma.Decimal, netExitProceedsAtStop: Prisma.Decimal): Prisma.Decimal {
  return D8(Prisma.Decimal.max(entryCostValue.minus(netExitProceedsAtStop), 0));
}

export function riskPct(riskAmountValue: Prisma.Decimal, preTradeEquity: Prisma.Decimal): Prisma.Decimal {
  return D8(new Prisma.Decimal(100).times(riskAmountValue).dividedBy(preTradeEquity));
}
