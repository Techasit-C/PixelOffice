import { describe, it, expect } from "vitest";
import {
  RISK_PER_TRADE_FRACTION,
  PRIMARY_WARMUP_BARS,
  CONFIRMATION_WARMUP_BARS,
  MAX_AFFORDABILITY_ADJUST_STEPS,
  MIN_QUANTITY,
  DEFAULT_SPREAD_BPS,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_FEE_RATE,
  DEFAULT_INITIAL_BALANCE,
  MAX_REQUESTED_RANGE_DAYS,
  CONFIG_BOUNDS,
} from "@/lib/backtest/config";

describe("lib/backtest/config.ts", () => {
  it("matches every constant fixed in the approved spec", () => {
    expect(RISK_PER_TRADE_FRACTION.toString()).toBe("0.005");
    expect(PRIMARY_WARMUP_BARS).toBe(60);
    expect(CONFIRMATION_WARMUP_BARS).toBe(50);
    expect(MAX_AFFORDABILITY_ADJUST_STEPS).toBe(8);
    // .toFixed() (no args), never .toString() — decimal.js's toString() switches to
    // exponential notation for magnitudes this small ("1e-8"), which would corrupt
    // fixed-point ledger/CSV serialization. .toFixed() never does. This is the
    // standard conversion used throughout lib/backtest/ (see decimal.ts, Task 3).
    expect(MIN_QUANTITY.toFixed()).toBe("0.00000001");
    expect(DEFAULT_SPREAD_BPS).toBe(5);
    expect(DEFAULT_SLIPPAGE_BPS).toBe(5);
    expect(DEFAULT_FEE_RATE.toString()).toBe("0.001");
    expect(DEFAULT_INITIAL_BALANCE.toString()).toBe("10000");
    expect(MAX_REQUESTED_RANGE_DAYS).toBe(365);
  });

  it("CONFIG_BOUNDS matches the spec's §2.1 table", () => {
    expect(CONFIG_BOUNDS.initialBalance).toEqual({ min: 100, max: 1_000_000 });
    expect(CONFIG_BOUNDS.feeRate).toEqual({ min: 0, max: 0.01 });
    expect(CONFIG_BOUNDS.spreadBps).toEqual({ min: 0, max: 100 });
    expect(CONFIG_BOUNDS.slippageBps).toEqual({ min: 0, max: 100 });
  });
});
