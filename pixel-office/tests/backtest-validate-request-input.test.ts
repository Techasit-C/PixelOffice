import { describe, it, expect } from "vitest";
import { validateBacktestRequestInput, type BacktestFormInput } from "@/lib/backtest/validate-request-input";

const ONE_DAY = 86_400_000;

function baseInput(overrides: Partial<BacktestFormInput> = {}): BacktestFormInput {
  return {
    symbol: "BTC/USDT",
    start: "2024-01-01",
    end: "2024-04-01", // ~91 days, well within [1,365]
    initialBalance: "10000",
    feeRate: "0.001",
    spreadBps: "5",
    slippageBps: "5",
    ...overrides,
  };
}

describe("validateBacktestRequestInput", () => {
  it("accepts a fully valid form and returns parsed numeric values", () => {
    const result = validateBacktestRequestInput(baseInput());
    expect(result.ok).toBe(true);
    expect(result.firstInvalidField).toBeNull();
    expect(result.errors).toEqual({});
    expect(result.parsed).not.toBeNull();
    expect(result.parsed!.initialBalance).toBe(10000);
  });

  it("rejects a symbol outside the allowlist", () => {
    const result = validateBacktestRequestInput(baseInput({ symbol: "DOGE/USDT" }));
    expect(result.ok).toBe(false);
    expect(result.errors.symbol).toBeDefined();
    expect(result.firstInvalidField).toBe("symbol");
  });

  it("rejects an empty or unparseable start date", () => {
    expect(validateBacktestRequestInput(baseInput({ start: "" })).errors.start).toBeDefined();
    expect(validateBacktestRequestInput(baseInput({ start: "not-a-date" })).errors.start).toBeDefined();
  });

  it("rejects end <= start", () => {
    const result = validateBacktestRequestInput(baseInput({ start: "2024-06-01", end: "2024-01-01" }));
    expect(result.ok).toBe(false);
    expect(result.errors.end).toBeDefined();
  });

  it("rejects a range under 1 day", () => {
    const start = new Date("2024-01-01T00:00:00Z");
    const end = new Date(start.getTime() + 12 * 3_600_000); // 12 hours
    const result = validateBacktestRequestInput(
      baseInput({ start: start.toISOString(), end: end.toISOString() }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.end).toMatch(/at least 1 day/);
  });

  it("rejects a range over 365 days", () => {
    const start = new Date("2024-01-01T00:00:00Z");
    const end = new Date(start.getTime() + 400 * ONE_DAY);
    const result = validateBacktestRequestInput(
      baseInput({ start: start.toISOString(), end: end.toISOString() }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.end).toMatch(/at most 365 days/);
  });

  it("accepts the exact 1-day and 365-day boundaries", () => {
    const start = new Date("2024-01-01T00:00:00Z");
    const oneDayEnd = new Date(start.getTime() + 1 * ONE_DAY);
    const maxEnd = new Date(start.getTime() + 365 * ONE_DAY);
    expect(validateBacktestRequestInput(baseInput({ start: start.toISOString(), end: oneDayEnd.toISOString() })).ok).toBe(true);
    expect(validateBacktestRequestInput(baseInput({ start: start.toISOString(), end: maxEnd.toISOString() })).ok).toBe(true);
  });

  describe("numeric bounds — mirror CONFIG_BOUNDS exactly", () => {
    it("rejects an out-of-bounds initialBalance (too low and too high)", () => {
      expect(validateBacktestRequestInput(baseInput({ initialBalance: "99" })).errors.initialBalance).toBeDefined();
      expect(validateBacktestRequestInput(baseInput({ initialBalance: "1000001" })).errors.initialBalance).toBeDefined();
    });

    it("accepts the initialBalance boundary values 100 and 1000000", () => {
      expect(validateBacktestRequestInput(baseInput({ initialBalance: "100" })).ok).toBe(true);
      expect(validateBacktestRequestInput(baseInput({ initialBalance: "1000000" })).ok).toBe(true);
    });

    it("rejects a non-numeric initialBalance", () => {
      expect(validateBacktestRequestInput(baseInput({ initialBalance: "abc" })).errors.initialBalance).toBeDefined();
    });

    it("rejects an out-of-bounds feeRate", () => {
      expect(validateBacktestRequestInput(baseInput({ feeRate: "-0.001" })).errors.feeRate).toBeDefined();
      expect(validateBacktestRequestInput(baseInput({ feeRate: "0.02" })).errors.feeRate).toBeDefined();
    });

    it("rejects an out-of-bounds spreadBps", () => {
      expect(validateBacktestRequestInput(baseInput({ spreadBps: "-1" })).errors.spreadBps).toBeDefined();
      expect(validateBacktestRequestInput(baseInput({ spreadBps: "101" })).errors.spreadBps).toBeDefined();
    });

    it("rejects an out-of-bounds slippageBps", () => {
      expect(validateBacktestRequestInput(baseInput({ slippageBps: "-1" })).errors.slippageBps).toBeDefined();
      expect(validateBacktestRequestInput(baseInput({ slippageBps: "101" })).errors.slippageBps).toBeDefined();
    });
  });

  it("reports every invalid field, and firstInvalidField follows the form's visual order regardless of which fields are wrong", () => {
    const result = validateBacktestRequestInput(
      baseInput({ symbol: "DOGE/USDT", initialBalance: "1", feeRate: "1" }),
    );
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["feeRate", "initialBalance", "symbol"].sort());
    expect(result.firstInvalidField).toBe("symbol"); // earliest in FIELD_ORDER
  });

  it("parsed is null whenever validation fails", () => {
    const result = validateBacktestRequestInput(baseInput({ symbol: "DOGE/USDT" }));
    expect(result.parsed).toBeNull();
  });
});
