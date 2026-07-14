import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { validateAndSizeEntry } from "@/lib/backtest/fills";

const feeRate = new Prisma.Decimal("0.001");
const cash = new Prisma.Decimal("10000");
const baseLevels = { entryZoneLow: 99, entryZoneHigh: 101, stopLoss: 95, takeProfit1: 110 };

describe("validateAndSizeEntry — rejection reasons, one fixture each", () => {
  it("GAP_THROUGH_STOP when the open is at or below the stop", () => {
    const r = validateAndSizeEntry(95, baseLevels, 5, 5, feeRate, cash);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("GAP_THROUGH_STOP");
  });

  it("GAP_THROUGH_TARGET when the open is at or above TP1", () => {
    const r = validateAndSizeEntry(110, baseLevels, 5, 5, feeRate, cash);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("GAP_THROUGH_TARGET");
  });

  it("ENTRY_ZONE_MISSED when the raw open is outside the entry zone", () => {
    const r = validateAndSizeEntry(105, baseLevels, 5, 5, feeRate, cash);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ENTRY_ZONE_MISSED");
  });

  it("ENTRY_ZONE_MISSED_AFTER_COSTS when costs push the fill just outside the zone", () => {
    // raw open (100) is inside [99,101], but a large spread+slippage pushes the
    // cost-adjusted execution price (100 * 1.005 * 1.005 = ~101.0025) past entryZoneHigh.
    const tightLevels = { ...baseLevels, entryZoneHigh: 100.5 };
    const r = validateAndSizeEntry(100, tightLevels, 50, 50, feeRate, cash);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ENTRY_ZONE_MISSED_AFTER_COSTS");
  });

  it("REALIZED_RR_BELOW_MINIMUM when the cost-adjusted net R:R is under 1.5", () => {
    const poorRR = { entryZoneLow: 99, entryZoneHigh: 101, stopLoss: 98, takeProfit1: 101.2 };
    const r = validateAndSizeEntry(100, poorRR, 5, 5, feeRate, cash);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("REALIZED_RR_BELOW_MINIMUM");
  });

  it("QUANTITY_TOO_SMALL when available cash cannot afford even one quantum", () => {
    const r = validateAndSizeEntry(100, baseLevels, 5, 5, feeRate, new Prisma.Decimal("0.0000001"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("QUANTITY_TOO_SMALL");
  });
});

describe("validateAndSizeEntry — accepted entry", () => {
  it("accepts a valid entry, sizes it by risk, and reports intended vs actual risk", () => {
    const r = validateAndSizeEntry(100, baseLevels, 5, 5, feeRate, cash);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entryCost.lessThanOrEqualTo(cash)).toBe(true);
      expect(r.actualNetRisk.lessThanOrEqualTo(r.intendedRiskBudget)).toBe(true);
      expect(r.netRiskReward).toBeGreaterThanOrEqual(1.5);
      expect(typeof r.cashCapped).toBe("boolean");
    }
  });

  it("sets cashCapped=true when cash affordability binds tighter than the risk budget", () => {
    // A tight stop (0.05% away) makes the per-unit risk tiny, so the 0.5%-of-equity
    // risk budget alone would permit a much larger quantity than the available cash
    // can actually afford — cash, not risk, is the binding constraint here.
    const tightStopLevels = { entryZoneLow: 99, entryZoneHigh: 101, stopLoss: 99.95, takeProfit1: 110 };
    const r = validateAndSizeEntry(100, tightStopLevels, 5, 5, feeRate, new Prisma.Decimal("50"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cashCapped).toBe(true);
  });
});
