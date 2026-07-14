import { Prisma } from "@prisma/client";
import { MOCK_FEE_RATE } from "./config";
import type { SourceSignal } from "./types";

/** notional + (notional * feeRate). Decimal math throughout. */
export function estimateOrderCost(
  notional: Prisma.Decimal,
  feeRate: Prisma.Decimal = MOCK_FEE_RATE,
): Prisma.Decimal {
  return notional.plus(notional.times(feeRate));
}

/**
 * BUY execution price: midpoint of the source signal's entry zone. Shared by
 * StubRiskEngine (cost estimation, before approval) and the orders route
 * (actual execution price passed to MockBroker), so the two can never disagree.
 */
export function deriveBuyExecutionPrice(sourceSignal: SourceSignal): Prisma.Decimal {
  const { low, high } = sourceSignal.entryZone;
  return new Prisma.Decimal(low).plus(high).dividedBy(2);
}
