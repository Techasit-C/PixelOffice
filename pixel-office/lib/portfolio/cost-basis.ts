// Cost-basis strategy — the recompute algorithm behind an interface so FIFO/LIFO/
// specific-lot can be added later WITHOUT touching callers (recompute, valuation,
// routes). Phase 1 ships AverageCostStrategy only.
//
// The transaction log is the source of truth. A strategy replays an asset's whole
// ordered transaction list and produces the derived Holding numbers (quantity,
// avgCostNative, avgCostThb) plus realized P&L. Pure — no DB, no network.
import { Prisma } from "@prisma/client";
import type { TransactionType } from "@prisma/client";
import { D, ZERO, type Decimal, type DecimalInput } from "./money";

/** Minimal transaction shape the math needs — decoupled from the Prisma row. */
export interface CostBasisTx {
  type: TransactionType; // BUY | SELL | DIVIDEND | FEE
  quantity: DecimalInput; // units (0 valid for DIVIDEND/FEE)
  executedPrice: DecimalInput; // per-unit, native currency
  currency: string; // native currency of price/fees
  fxRateUsdThb: DecimalInput; // IMMUTABLE snapshot at execution
  fees?: DecimalInput; // native currency, optional
  executedAt: Date; // ordering key
}

/** The derived Holding numbers + realized P&L, all in Decimal. */
export interface HoldingComputation {
  quantity: Decimal;
  avgCostNative: Decimal; // per unit, native currency
  avgCostThb: Decimal; // per unit, THB (from snapshotted FX)
  totalCostNative: Decimal; // avgCostNative * quantity
  totalCostThb: Decimal; // avgCostThb * quantity
  realizedPnlNative: Decimal; // accumulates on sells (native currency)
}

export interface CostBasisStrategy {
  readonly method: "AVERAGE_COST" | "FIFO" | "LIFO" | "SPECIFIC_LOT";
  compute(transactions: CostBasisTx[]): HoldingComputation;
}

/** Thrown when a SELL exceeds the quantity currently held. */
export class InsufficientQuantityError extends Error {
  constructor(held: Decimal, sold: Decimal) {
    super(`Cannot sell ${sold.toString()} units; only ${held.toString()} held`);
    this.name = "InsufficientQuantityError";
  }
}

function empty(): HoldingComputation {
  return {
    quantity: ZERO,
    avgCostNative: ZERO,
    avgCostThb: ZERO,
    totalCostNative: ZERO,
    totalCostThb: ZERO,
    realizedPnlNative: ZERO,
  };
}

/**
 * Average-cost method.
 *  BUY  : qty += q; totalCost += q*price + fees; avgCost = totalCost / qty.
 *         (native and THB tracked in parallel, THB using each tx's OWN fx snapshot)
 *  SELL : avg cost per unit UNCHANGED; totalCost reduced proportionally to remaining
 *         qty; realized P&L += (price - avgCostNative)*q - fees. Guard: q <= held.
 *  DIVIDEND / FEE : cash events — no effect on quantity or average cost here.
 */
export class AverageCostStrategy implements CostBasisStrategy {
  readonly method = "AVERAGE_COST" as const;

  compute(transactions: CostBasisTx[]): HoldingComputation {
    if (transactions.length === 0) return empty();

    const ordered = [...transactions].sort(
      (a, b) => a.executedAt.getTime() - b.executedAt.getTime(),
    );

    let qty = new Prisma.Decimal(0);
    let totalNative = new Prisma.Decimal(0);
    let totalThb = new Prisma.Decimal(0);
    let realized = new Prisma.Decimal(0);
    let avgNative = new Prisma.Decimal(0);
    let avgThb = new Prisma.Decimal(0);

    for (const tx of ordered) {
      const q = D(tx.quantity);
      const price = D(tx.executedPrice);
      const fx = D(tx.fxRateUsdThb);
      const fees = D(tx.fees);

      if (tx.type === "BUY") {
        const grossNative = q.times(price).plus(fees);
        totalNative = totalNative.plus(grossNative);
        totalThb = totalThb.plus(grossNative.times(fx));
        qty = qty.plus(q);
        avgNative = qty.isZero() ? ZERO : totalNative.div(qty);
        avgThb = qty.isZero() ? ZERO : totalThb.div(qty);
      } else if (tx.type === "SELL") {
        if (q.greaterThan(qty)) {
          throw new InsufficientQuantityError(qty, q);
        }
        // Realized P&L against the (unchanged) average cost, net of sell fees.
        realized = realized
          .plus(price.minus(avgNative).times(q))
          .minus(fees);
        qty = qty.minus(q);
        // avg cost per unit stays; re-derive totals from remaining qty.
        totalNative = avgNative.times(qty);
        totalThb = avgThb.times(qty);
        if (qty.isZero()) {
          // position fully closed — reset avg to 0 so a later re-buy starts clean.
          avgNative = ZERO;
          avgThb = ZERO;
        }
      }
      // DIVIDEND / FEE: no position/cost-basis effect in average-cost Phase 1.
    }

    return {
      quantity: qty,
      avgCostNative: avgNative,
      avgCostThb: avgThb,
      totalCostNative: totalNative,
      totalCostThb: totalThb,
      realizedPnlNative: realized,
    };
  }
}

/** Default strategy factory. Add a switch here when FIFO/LIFO land. */
export function getCostBasisStrategy(
  method: "AVERAGE_COST" | "FIFO" | "LIFO" | "SPECIFIC_LOT" = "AVERAGE_COST",
): CostBasisStrategy {
  switch (method) {
    case "AVERAGE_COST":
      return new AverageCostStrategy();
    default:
      // Phase 1: only average cost is implemented. Fail loudly rather than
      // silently mis-computing basis with the wrong method.
      throw new Error(`Cost-basis method not implemented yet: ${method}`);
  }
}
