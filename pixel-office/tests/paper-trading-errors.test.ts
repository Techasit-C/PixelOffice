import { describe, expect, it } from "vitest";
import { REJECT_CODES } from "@/lib/paper-trading/types";
import { defaultReason } from "@/lib/paper-trading/errors";

describe("paper-trading defaultReason", () => {
  it("returns a non-empty reason for every reject code", () => {
    for (const code of REJECT_CODES) {
      const reason = defaultReason(code);
      expect(reason).toBeTypeOf("string");
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it("has exactly 21 reject codes, matching the approved design (§11/§12/§7)", () => {
    expect(REJECT_CODES.length).toBe(21);
  });

  it("gives every reject code a unique reason string", () => {
    const reasons = REJECT_CODES.map((code) => defaultReason(code));
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("includes every code named in the design's opening and closing rule tables", () => {
    const expected = [
      "GENERATION_MISMATCH",
      "EMERGENCY_STOP_ACTIVE",
      "STALE_CANDLE_DATA",
      "RISK_UNCONFIRMED",
      "NON_POSITIVE_EQUITY",
      "MISSING_STOP_LOSS",
      "INVALID_STOP_LOSS",
      "POSITION_ALREADY_OPEN",
      "MAX_RISK_PER_TRADE",
      "MAX_POSITION_SIZE",
      "MAX_TOTAL_EXPOSURE",
      "MAX_OPEN_POSITIONS",
      "DAILY_LOSS_LIMIT",
      "MAX_DRAWDOWN",
      "MAX_ORDER_FREQUENCY",
      "COOLDOWN_ACTIVE",
      "INSUFFICIENT_FUNDS",
      "NO_OPEN_POSITION",
      "INSUFFICIENT_POSITION",
      "INVALID_QUANTITY_PRECISION",
      "PROVIDER_UNAVAILABLE",
    ] as const;
    expect([...REJECT_CODES].sort()).toEqual([...expected].sort());
  });
});
