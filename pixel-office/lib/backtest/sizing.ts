// Bounded cash-and-risk-budget adjustment loop — a HARD cap, no tolerance constant,
// ever, without separate approval. Shared by strategy entry sizing (fills.ts,
// riskBudget != null) and benchmark sizing (benchmark.ts, riskBudget = null,
// cash-only). Pure, deterministic, no I/O.
import { Prisma } from "@prisma/client";
import { D8, ONE_QUANTITY_QUANTUM } from "./decimal";
import { MAX_AFFORDABILITY_ADJUST_STEPS } from "./config";

export interface SizingAccept {
  ok: true;
  quantity: Prisma.Decimal;
  entryNotional: Prisma.Decimal;
  entryFee: Prisma.Decimal;
  entryCost: Prisma.Decimal;
  actualNetRisk: Prisma.Decimal | null;
}
export interface SizingReject {
  ok: false;
  reason: "QUANTITY_TOO_SMALL" | "INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE" | "RISK_BUDGET_UNREPRESENTABLE";
}
export type SizingResult = SizingAccept | SizingReject;

export function sizeWithinCashAndRisk(
  initialQuantity: Prisma.Decimal,
  entryExecutionPrice: Prisma.Decimal,
  feeRate: Prisma.Decimal,
  availableCash: Prisma.Decimal,
  riskBudget: Prisma.Decimal | null,
  hypotheticalStopExecutionPrice: Prisma.Decimal | null,
): SizingResult {
  let quantity = initialQuantity;
  let lastCashOk = false;

  for (let step = 0; step < MAX_AFFORDABILITY_ADJUST_STEPS; step++) {
    if (quantity.lessThanOrEqualTo(0)) {
      return { ok: false, reason: "QUANTITY_TOO_SMALL" };
    }

    const entryNotional = D8(quantity.times(entryExecutionPrice));
    const entryFee = D8(entryNotional.times(feeRate));
    const entryCost = D8(entryNotional.plus(entryFee));

    let actualNetRisk: Prisma.Decimal | null = null;
    let riskOk = true;
    if (riskBudget !== null && hypotheticalStopExecutionPrice !== null) {
      const stopNotional = D8(quantity.times(hypotheticalStopExecutionPrice));
      const stopFee = D8(stopNotional.times(feeRate));
      const stopProceeds = D8(stopNotional.minus(stopFee));
      actualNetRisk = D8(entryCost.minus(stopProceeds));
      riskOk = actualNetRisk.lessThanOrEqualTo(riskBudget);
    }

    const cashOk = entryCost.lessThanOrEqualTo(availableCash);
    lastCashOk = cashOk;

    if (cashOk && riskOk) {
      return { ok: true, quantity, entryNotional, entryFee, entryCost, actualNetRisk };
    }
    quantity = quantity.minus(ONE_QUANTITY_QUANTUM);
  }

  return { ok: false, reason: lastCashOk ? "RISK_BUDGET_UNREPRESENTABLE" : "INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE" };
}
