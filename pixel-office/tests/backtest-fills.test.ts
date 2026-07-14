import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { askPrice, bidPrice, detectExitTrigger, gapExitRawMid, computeExit } from "@/lib/backtest/fills";
import { toFixedString } from "@/lib/backtest/decimal";

describe("askPrice / bidPrice — spread and slippage stay separate but compound", () => {
  it("askPrice = mid * (1+spread/20000) * (1+slippage/10000)", () => {
    // spread=5bps -> +0.00025 ; slippage=5bps -> +0.0005
    expect(toFixedString(askPrice(100, 5, 5))).toBe(
      toFixedString(new Prisma.Decimal(100).times(1.00025).times(1.0005)),
    );
  });

  it("bidPrice = mid * (1-spread/20000) * (1-slippage/10000)", () => {
    expect(toFixedString(bidPrice(100, 5, 5))).toBe(
      toFixedString(new Prisma.Decimal(100).times(0.99975).times(0.9995)),
    );
  });

  it("spread-only (slippage=0) and slippage-only (spread=0) each apply independently", () => {
    expect(toFixedString(askPrice(100, 5, 0))).toBe("100.02500000");
    expect(toFixedString(askPrice(100, 0, 5))).toBe("100.05000000");
  });

  it("zero spread and zero slippage leaves the price unchanged", () => {
    expect(toFixedString(askPrice(100, 0, 0))).toBe("100.00000000");
    expect(toFixedString(bidPrice(100, 0, 0))).toBe("100.00000000");
  });
});

describe("detectExitTrigger — stop-first on ambiguity", () => {
  it("returns NONE when neither level is touched", () => {
    expect(detectExitTrigger(95, 105, 90, 110)).toBe("NONE");
  });
  it("returns STOP when only the stop is touched", () => {
    expect(detectExitTrigger(89, 100, 90, 110)).toBe("STOP");
  });
  it("returns TP1 when only the target is touched", () => {
    expect(detectExitTrigger(95, 111, 90, 110)).toBe("TP1");
  });
  it("returns STOP when BOTH are touched in the same bar (conservative, unconditional)", () => {
    expect(detectExitTrigger(89, 111, 90, 110)).toBe("STOP");
  });
});

describe("gapExitRawMid — open-based gap-through fills", () => {
  it("returns null when the open has not gapped through either level", () => {
    expect(gapExitRawMid(100, 90, 110)).toBeNull();
  });
  it("fills at the raw open when the open already gapped through the stop", () => {
    expect(gapExitRawMid(85, 90, 110)).toEqual({ trigger: "STOP", rawMid: 85 });
  });
  it("fills at the raw open when the open already gapped through the target", () => {
    expect(gapExitRawMid(115, 90, 110)).toEqual({ trigger: "TP1", rawMid: 115 });
  });
});

describe("computeExit — total-notional accounting, never per-unit-fee-times-quantity", () => {
  it("computes exitNotional/exitFee/exitProceeds/realizedPnl from total notional", () => {
    const quantity = new Prisma.Decimal("2");
    const entryCost = new Prisma.Decimal("200");
    const result = computeExit(105, 0, 0, new Prisma.Decimal("0.001"), quantity, entryCost);
    expect(toFixedString(result.exitExecutionPrice)).toBe("105.00000000");
    expect(toFixedString(result.exitNotional)).toBe("210.00000000");
    expect(toFixedString(result.exitFee)).toBe("0.21000000");
    expect(toFixedString(result.exitProceeds)).toBe("209.79000000");
    expect(toFixedString(result.realizedPnl)).toBe("9.79000000");
  });
});
