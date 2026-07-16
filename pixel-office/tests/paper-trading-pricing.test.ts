// Every expected value below is hand-calculated independently (see the plan's Task 1.2
// verification notes), not copied from a print of the implementation's own output.
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  entryExecutionPrice,
  exitExecutionPrice,
  entryNotional,
  entryFee,
  entryCost,
  newPositionLiquidationValue,
  exitNotional,
  exitFee,
  exitProceeds,
  allocatedCostBasisPartial,
  allocatedCostBasisFull,
  realizedPnl,
  remainingCostBasis,
  riskAmount,
  riskPct,
} from "@/lib/paper-trading/pricing";

const FEE_RATE = new Prisma.Decimal("0.001");
const SPREAD_BPS = 5;
const SLIPPAGE_BPS = 5;

describe("BUY entry accounting — quantity=1, referenceMark=50000, 5bps/5bps, 0.1% fee", () => {
  const quantity = new Prisma.Decimal("1");
  const price = entryExecutionPrice(50000, SPREAD_BPS, SLIPPAGE_BPS);
  const notional = entryNotional(quantity, price);
  const fee = entryFee(notional, FEE_RATE);
  const cost = entryCost(notional, fee);

  it("entryExecutionPrice = askPrice(50000, 5, 5) = 50037.50625000", () => {
    expect(price.toFixed(8)).toBe("50037.50625000");
  });

  it("entryNotional = quantity * entryExecutionPrice = 50037.50625000", () => {
    expect(notional.toFixed(8)).toBe("50037.50625000");
  });

  it("entryFee = entryNotional * feeRate = 50.03750625", () => {
    expect(fee.toFixed(8)).toBe("50.03750625");
  });

  it("entryCost = entryNotional + entryFee = 50087.54375625", () => {
    expect(cost.toFixed(8)).toBe("50087.54375625");
  });
});

describe("newPositionLiquidationValue uses bid, not ask", () => {
  it("differs from entryNotional for the same inputs (proves the two conventions are not conflated)", () => {
    const quantity = new Prisma.Decimal("1");
    const liquidationValue = newPositionLiquidationValue(quantity, 50000, SPREAD_BPS, SLIPPAGE_BPS);
    const notional = entryNotional(quantity, entryExecutionPrice(50000, SPREAD_BPS, SLIPPAGE_BPS));
    expect(liquidationValue.equals(notional)).toBe(false);
    // bid(50000,5,5) = 50000 * 0.99975 * 0.9995 = 49962.50625
    expect(liquidationValue.toFixed(8)).toBe("49962.50625000");
  });
});

describe("partial-close cost-basis allocation — previousCostBasis=30000, previousQuantity=1.0, closedQuantity=0.4, exit referenceMark=52000", () => {
  const previousCostBasis = new Prisma.Decimal("30000");
  const previousQuantity = new Prisma.Decimal("1.0");
  const closedQuantity = new Prisma.Decimal("0.4");
  const exitPrice = exitExecutionPrice(52000, SPREAD_BPS, SLIPPAGE_BPS);
  const notional = exitNotional(closedQuantity, exitPrice);
  const fee = exitFee(notional, FEE_RATE);
  const proceeds = exitProceeds(notional, fee);
  const allocated = allocatedCostBasisPartial(previousCostBasis, closedQuantity, previousQuantity);
  const pnl = realizedPnl(proceeds, allocated);
  const remaining = remainingCostBasis(previousCostBasis, allocated);

  it("exitExecutionPrice = bidPrice(52000, 5, 5) = 51961.00650000", () => {
    expect(exitPrice.toFixed(8)).toBe("51961.00650000");
  });

  it("exitProceeds = 20763.61819740", () => {
    expect(proceeds.toFixed(8)).toBe("20763.61819740");
  });

  it("allocatedCostBasis = previousCostBasis * (closedQuantity / previousQuantity) = 12000.00000000", () => {
    expect(allocated.toFixed(8)).toBe("12000.00000000");
  });

  it("realizedPnl = exitProceeds - allocatedCostBasis = 8763.61819740", () => {
    expect(pnl.toFixed(8)).toBe("8763.61819740");
  });

  it("remainingCostBasis = previousCostBasis - allocatedCostBasis = 18000.00000000", () => {
    expect(remaining.toFixed(8)).toBe("18000.00000000");
  });
});

describe("full close — exact assignment, never a ratio, zero rounding dust", () => {
  it("allocatedCostBasisFull equals previousCostBasis exactly, even with an ugly value", () => {
    const previousCostBasis = new Prisma.Decimal("18000.12345678");
    const allocated = allocatedCostBasisFull(previousCostBasis);
    expect(allocated.toFixed(8)).toBe("18000.12345678");
    const remaining = remainingCostBasis(previousCostBasis, allocated);
    expect(remaining.toFixed(8)).toBe("0.00000000");
  });
});

describe("pre-trade risk amount vs. actual fill loss at the stop — parity, no drift", () => {
  const quantity = new Prisma.Decimal("0.5");
  const stopLoss = 48000;

  it("riskAmount (pre-trade, entry referenceMark=50000) is 1085.75088113", () => {
    const price = entryExecutionPrice(50000, SPREAD_BPS, SLIPPAGE_BPS);
    const notional = entryNotional(quantity, price);
    const fee = entryFee(notional, FEE_RATE);
    const cost = entryCost(notional, fee);

    const stopExit = exitExecutionPrice(stopLoss, SPREAD_BPS, SLIPPAGE_BPS);
    const stopNotional = exitNotional(quantity, stopExit);
    const stopFee = exitFee(stopNotional, FEE_RATE);
    const netExitProceedsAtStop = exitProceeds(stopNotional, stopFee);

    const risk = riskAmount(cost, netExitProceedsAtStop);
    expect(risk.toFixed(8)).toBe("1085.75088113");

    // The actual fill, executed at exactly the stop price, must lose exactly this much —
    // computed via the SAME askPrice/bidPrice/D8 functions, proving no drift or double count.
    const actualExitPrice = exitExecutionPrice(stopLoss, SPREAD_BPS, SLIPPAGE_BPS);
    const actualExitNotional = exitNotional(quantity, actualExitPrice);
    const actualExitFee = exitFee(actualExitNotional, FEE_RATE);
    const actualExitProceeds = exitProceeds(actualExitNotional, actualExitFee);
    const allocated = allocatedCostBasisFull(cost); // full close, sole entry
    const actualPnl = realizedPnl(actualExitProceeds, allocated);

    expect(actualPnl.toFixed(8)).toBe("-1085.75088113");
    expect(risk.toFixed(8)).toBe(actualPnl.negated().toFixed(8));
  });

  it("riskAmount never goes negative (max(0, ...))", () => {
    // A stop ABOVE the entry cost basis would make the naive subtraction negative;
    // riskAmount must clamp to zero, never a negative "risk".
    const cost = new Prisma.Decimal("100");
    const netExitProceedsAtStop = new Prisma.Decimal("150");
    expect(riskAmount(cost, netExitProceedsAtStop).toFixed(8)).toBe("0.00000000");
  });
});

describe("riskPct", () => {
  it("riskPct = D8(100 * riskAmount / preTradeEquity)", () => {
    const risk = new Prisma.Decimal("1085.75088113");
    const equity = new Prisma.Decimal("10000");
    expect(riskPct(risk, equity).toFixed(8)).toBe("10.85750881");
  });
});
