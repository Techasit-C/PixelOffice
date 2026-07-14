import { describe, it, expect } from "vitest";
import { PAPER_STARTING_BALANCE_USDT, MOCK_FEE_RATE, SIGNAL_FRESHNESS_WINDOW_MS } from "@/lib/trading-bot/config";
import { defaultReason } from "@/lib/trading-bot/errors";

describe("trading-bot config", () => {
  it("locks the approved Phase 1 constants", () => {
    expect(PAPER_STARTING_BALANCE_USDT.toString()).toBe("10000");
    expect(MOCK_FEE_RATE.toString()).toBe("0.001");
    expect(SIGNAL_FRESHNESS_WINDOW_MS).toBe(5 * 60_000);
  });

  it("has a default reason for every RejectCode", () => {
    const codes = [
      "UNRECOGNIZED_SIGNAL", "NON_ACTIONABLE_SIGNAL", "UNSUPPORTED_SHORT",
      "STALE_SIGNAL", "STALE_CANDLE_DATA", "INVALID_QUANTITY",
      "MISSING_STOP_LOSS", "INSUFFICIENT_FUNDS", "INSUFFICIENT_POSITION",
      "NO_OPEN_POSITION",
    ] as const;
    for (const code of codes) {
      expect(defaultReason(code).length).toBeGreaterThan(0);
    }
  });
});
