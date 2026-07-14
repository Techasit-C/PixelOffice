# AI Trading Bot — Phase 3 Backtesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a deterministic, long-only backtesting system for the accepted
Phase 2 signal engine, exactly as defined in
`docs/superpowers/specs/2026-07-15-trading-bot-phase3-backtesting-design.md`
("the spec"), status **Approved for implementation planning**.

**Architecture:** A new, isolated `lib/backtest/` deterministic core (no I/O, no wall
clock) reuses `buildSignalFromCandles` from the accepted `lib/trading-signals/` engine
unmodified. A new, isolated `lib/market-data/historical-candles.ts` performs paginated
MEXC fetches and is never imported by `lib/backtest/`. A new API route
(`app/api/trading-bot/backtest/route.ts`) is the only place that composes fetch (network)
with `runBacktest` (pure). A new minimal UI page renders the result and exports the
trade-ledger CSV client-side. No persistence anywhere.

**Tech Stack:** Next.js 15 Route Handlers, TypeScript, `Prisma.Decimal` for all monetary
math, Vitest (node environment, no network/no wall-clock in the deterministic suite),
Clerk (`requireUser`), the existing in-memory rate limiter (`enforceRateLimit`).

## Global Constraints

All exact values below are copied verbatim from the spec and apply to every task unless
a task overrides one explicitly.

- `MIN_RR = 1.5` (reused from `lib/trading-signals/config.ts`).
- `RISK_PER_TRADE_FRACTION = 0.005` (0.5% of equity, hard cap, no tolerance).
- `PRIMARY_WARMUP_BARS = 60`, `CONFIRMATION_WARMUP_BARS = 50`.
- `spreadBps` default 5, `slippageBps` default 5 — **two permanently separate config
  inputs**, never blended into one value; compounded only in the execution-price formula.
- `feeRate` default `0.001`, `initialBalance` default `10000` USDT.
- `MIN_QUANTITY = 0.00000001` (one quantity quantum, 8dp).
- `MAX_AFFORDABILITY_ADJUST_STEPS = 8` — fixed; never raised, no tolerance constant
  introduced, without separate explicit approval.
- `PRIMARY_CONTIGUITY_TOLERANCE_MS = 0` (exact contiguity required).
- `MAX_REQUESTED_RANGE_DAYS = 365`.
- `MEXC_PAGE_LIMIT = 500` (empirically verified, not a documented contract).
- `MAX_PAGES_PER_TIMEFRAME = 20`, `HISTORICAL_FETCH_TIMEOUT_MS = 6000` per page.
- `ROUTE_MAX_DURATION_S = 60`, `INTERNAL_DEADLINE_S = 55`.
- `RESPONSE_SIZE_CAP_BYTES = 2097152` (2 MB, self-imposed, measured as UTF-8 byte length).
- `EQUITY_CHART_MAX_POINTS = 500` (chart-only downsampling; metrics always use
  full-resolution data; **no equity-curve CSV of any resolution is offered** — trade
  ledger CSV only).
- Config bounds (server-side allowlist, validated before any fetch): `symbol` ∈
  `{"BTC/USDT","ETH/USDT","SOL/USDT"}`; `timeframe = "4h"` only;
  `1 day ≤ (requestedEnd − requestedStart) ≤ 365 days`; `100 ≤ initialBalance ≤ 1,000,000`;
  `0 ≤ feeRate ≤ 0.01`; `0 ≤ spreadBps ≤ 100`; `0 ≤ slippageBps ≤ 100`.
- `D8(x)` = `Prisma.Decimal`, 8dp, `ROUND_HALF_UP`. `Q8(x)` = `Prisma.Decimal`, 8dp,
  `ROUND_DOWN` — quantity only, never rounded up.
- `lib/backtest/` may import only: `lib/trading-signals/{indicators,setup,risk-gate,macd,
  bollinger,candle-closed,multi-timeframe,enrichment,engine,types,config}.ts` and
  `type { Candle }` from `lib/market-data/candles.ts`. It must **never** import
  `getCandles`, `lib/market-data/historical-candles.ts`, anything under
  `lib/trading-bot/`, any broker adapter, or credentials.
- Deterministic tests (everything except the explicitly-named live-provider tests in
  Task 7) never touch the network or `Date.now()`/wall clock — every timestamp is a
  fixed, injected epoch-ms literal.
- No database migration, persistence, optimization/parameter-sweep, background job,
  broker API, credentials, live trading, leverage, margin, or executable short path
  anywhere in this plan.
- Never stage or modify `pixel-office/components/portfolio/ui.tsx` — it carries a
  pre-existing, unrelated, in-progress change. Every `git add` in this plan names files
  explicitly; never `git add -A` / `git add .`.
- Preserve Phase 1 and Phase 2 behavior and safety invariants unmodified — this plan
  only adds new files plus one additive extension to
  `tests/trading-signals-safety.test.ts`'s `targets` array (Task 22).

---

## Checkpoint 1 — Types, Decimal Rules, Validation, and Historical-Data Normalization

### Task 1: Domain types, DTOs, and rejection-reason enum

**Files:**
- Create: `pixel-office/lib/backtest/types.ts`
- Test: `pixel-office/tests/backtest-types.test.ts`

**Interfaces:**
- Produces: `RejectionReason`, `ExitReason`, `TradeLedgerEntry`, `EquityPoint`,
  `DataQualityReport`, `UnexecutedSignalRecord`, `ExecutionEvent`, `BacktestConfig`,
  `BacktestMetrics`, `BenchmarkResult`, `BacktestResult` — every later task imports its
  types from this file exclusively; no task redefines a shape locally.

This task has no interesting behavior to test (pure type declarations), so its "test" is
a compile-time usage smoke test proving every exported type is importable and
structurally assignable the way later tasks will need it.

- [ ] **Step 1: Write the failing test**

```ts
// pixel-office/tests/backtest-types.test.ts
import { describe, it, expect } from "vitest";
import type {
  RejectionReason,
  ExitReason,
  TradeLedgerEntry,
  EquityPoint,
  DataQualityReport,
  UnexecutedSignalRecord,
  ExecutionEvent,
  BacktestConfig,
  BacktestMetrics,
  BenchmarkResult,
  BacktestResult,
} from "@/lib/backtest/types";

describe("lib/backtest/types.ts", () => {
  it("RejectionReason covers every named reason from the spec", () => {
    const reasons: RejectionReason[] = [
      "GAP_BEFORE_ENTRY",
      "GAP_THROUGH_STOP",
      "GAP_THROUGH_TARGET",
      "ENTRY_ZONE_MISSED",
      "ENTRY_ZONE_MISSED_AFTER_COSTS",
      "COST_ADJUSTED_ENTRY_INVALID",
      "NON_POSITIVE_NET_RISK",
      "NON_POSITIVE_NET_REWARD",
      "REALIZED_RR_BELOW_MINIMUM",
      "QUANTITY_TOO_SMALL",
      "INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE",
      "RISK_BUDGET_UNREPRESENTABLE",
      "NON_POSITIVE_ACTUAL_RISK",
    ];
    expect(reasons.length).toBe(13);
  });

  it("ExitReason covers STOP/TP1/END_OF_TEST only", () => {
    const reasons: ExitReason[] = ["STOP", "TP1", "END_OF_TEST"];
    expect(reasons.length).toBe(3);
  });

  it("a fully-populated TradeLedgerEntry, EquityPoint, DataQualityReport, and BacktestResult type-check", () => {
    const ledgerEntry: TradeLedgerEntry = {
      entryTime: 0, entryPrice: "0", quantity: "0", entryNotional: "0", entryFee: "0",
      entryCost: "0", exitTime: 0, exitPrice: "0", exitReason: "STOP", exitNotional: "0",
      exitFee: "0", exitProceeds: "0", realizedPnl: "0", intendedRiskBudget: "0",
      actualNetRisk: "0", actualRiskFraction: 0, cashCapped: false, netRiskReward: 0,
      warnings: [],
    };
    const equityPoint: EquityPoint = { time: 0, equity: "0" };
    const report: DataQualityReport = {
      malformedCount: 0, invalidOhlcCount: 0, exactDuplicateCount: 0,
      conflictingDuplicateCount: 0, reordered: false, reorderCount: 0, gapCount: 0,
      gaps: [], coverageShortfall: null,
    };
    const unexecuted: UnexecutedSignalRecord = { barCloseTime: 0, reason: "GAP_BEFORE_ENTRY" };
    const event: ExecutionEvent = { type: "SIGNAL_COMPUTED", time: 0, sequenceNumber: 0 };
    const config: BacktestConfig = {
      symbol: "BTC/USDT", requestedStart: 0, requestedEnd: 0,
      initialBalance: "10000", feeRate: "0.001", spreadBps: 5, slippageBps: 5,
    };
    const metrics: BacktestMetrics = {
      netProfit: "0", totalReturn: 0, winRate: 0, lossRate: 0, profitFactor: null,
      profitFactorReason: "undefined — no losing trades in this run", maxDrawdownPct: 0,
      sharpe: null, tradeCount: 0, averageWin: "0", averageLoss: "0", expectancy: "0",
    };
    const benchmark: BenchmarkResult = {
      entryTime: 0, entryPrice: "0", quantity: "0", exitTime: 0, exitPrice: "0",
      finalCash: "10000", metrics, equityCurve: [equityPoint],
    };
    const result: BacktestResult = {
      engineVersion: "phase3-v1", symbol: "BTC/USDT", timeframe: "4h",
      dataSource: "MEXC public klines",
      requestedRange: { start: 0, end: 0 },
      fetchedWarmupRange: {
        primary: { start: 0, end: 0 }, oneHour: { start: 0, end: 0 }, oneDay: { start: 0, end: 0 },
      },
      actualEvaluationRange: { start: 0, end: 0 },
      candleCounts: { primary: 0, oneHour: 0, oneDay: 0 },
      config: { initialBalance: "10000", feeRate: "0.001", spreadBps: 5, slippageBps: 5, riskPerTradeFraction: "0.005" },
      dataQuality: report,
      tradeLedger: [ledgerEntry],
      unexecutedSignals: [unexecuted],
      equityCurve: [equityPoint],
      equityCurveChart: [equityPoint],
      metrics,
      benchmark,
      warnings: [],
    };
    expect(result.events).toBeUndefined(); // events live on SimulateResult (Task 13), not BacktestResult
    expect([ledgerEntry, equityPoint, report, unexecuted, event, config, metrics, benchmark].length).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pixel-office && npx vitest run tests/backtest-types.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/types'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/types.ts
//
// Domain types for the deterministic Phase 3 backtesting core. No I/O, no wall clock.
// SAFETY: nothing here may reference order/withdraw/transfer/execute/leverage/broker
// capability — this module is scanned by the extended trading-signals safety test
// (Task 22).
export type PrimaryTimeframe = "4h";

export type RejectionReason =
  | "GAP_BEFORE_ENTRY"
  | "GAP_THROUGH_STOP"
  | "GAP_THROUGH_TARGET"
  | "ENTRY_ZONE_MISSED"
  | "ENTRY_ZONE_MISSED_AFTER_COSTS"
  | "COST_ADJUSTED_ENTRY_INVALID"
  | "NON_POSITIVE_NET_RISK"
  | "NON_POSITIVE_NET_REWARD"
  | "REALIZED_RR_BELOW_MINIMUM"
  | "QUANTITY_TOO_SMALL"
  | "INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE"
  | "RISK_BUDGET_UNREPRESENTABLE"
  | "NON_POSITIVE_ACTUAL_RISK";

export type ExitReason = "STOP" | "TP1" | "END_OF_TEST";

export interface TradeLedgerEntry {
  entryTime: number;
  entryPrice: string;
  quantity: string;
  entryNotional: string;
  entryFee: string;
  entryCost: string;
  exitTime: number;
  exitPrice: string;
  exitReason: ExitReason;
  exitNotional: string;
  exitFee: string;
  exitProceeds: string;
  realizedPnl: string;
  intendedRiskBudget: string;
  actualNetRisk: string;
  actualRiskFraction: number;
  cashCapped: boolean;
  netRiskReward: number;
  warnings: string[];
}

export interface EquityPoint {
  time: number;
  equity: string;
}

export interface DataQualityReport {
  malformedCount: number;
  invalidOhlcCount: number;
  exactDuplicateCount: number;
  conflictingDuplicateCount: number;
  reordered: boolean;
  reorderCount: number;
  gapCount: number;
  gaps: { after: number; before: number; missingBars: number }[];
  coverageShortfall: {
    requestedStart: number;
    requestedEnd: number;
    actualStart: number | null;
    actualEnd: number | null;
  } | null;
}

export interface UnexecutedSignalRecord {
  barCloseTime: number;
  reason: RejectionReason;
}

export interface ExecutionEvent {
  type:
    | "SIGNAL_COMPUTED"
    | "ENTRY_PROCESSED"
    | "GAP_EXIT_PROCESSED"
    | "INTRABAR_EXIT_PROCESSED"
    | "EQUITY_MARKED";
  time: number;
  sequenceNumber: number;
}

export interface BacktestConfig {
  symbol: string;
  requestedStart: number;
  requestedEnd: number;
  initialBalance: string;
  feeRate: string;
  spreadBps: number;
  slippageBps: number;
}

export interface BacktestMetrics {
  netProfit: string;
  totalReturn: number;
  winRate: number;
  lossRate: number;
  profitFactor: number | null;
  profitFactorReason: string | null;
  maxDrawdownPct: number;
  sharpe: number | null;
  tradeCount: number;
  averageWin: string;
  averageLoss: string;
  expectancy: string;
}

export interface BenchmarkResult {
  entryTime: number;
  entryPrice: string;
  quantity: string;
  exitTime: number;
  exitPrice: string;
  finalCash: string;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
}

export interface BacktestResult {
  engineVersion: string;
  symbol: string;
  timeframe: PrimaryTimeframe;
  dataSource: "MEXC public klines";
  requestedRange: { start: number; end: number };
  fetchedWarmupRange: {
    primary: { start: number; end: number };
    oneHour: { start: number; end: number };
    oneDay: { start: number; end: number };
  };
  actualEvaluationRange: { start: number; end: number };
  candleCounts: { primary: number; oneHour: number; oneDay: number };
  config: {
    initialBalance: string;
    feeRate: string;
    spreadBps: number;
    slippageBps: number;
    riskPerTradeFraction: string;
  };
  dataQuality: DataQualityReport;
  tradeLedger: TradeLedgerEntry[];
  unexecutedSignals: UnexecutedSignalRecord[];
  equityCurve: EquityPoint[];
  equityCurveChart: EquityPoint[];
  metrics: BacktestMetrics;
  benchmark: BenchmarkResult;
  warnings: string[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pixel-office && npx vitest run tests/backtest-types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/types.ts pixel-office/tests/backtest-types.test.ts
git commit -m "feat(backtest): add Phase 3 domain types"
```

---

### Task 2: Configuration constants and bounds

**Files:**
- Create: `pixel-office/lib/backtest/config.ts`
- Test: `pixel-office/tests/backtest-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RISK_PER_TRADE_FRACTION`, `PRIMARY_WARMUP_BARS`, `CONFIRMATION_WARMUP_BARS`,
  `MAX_AFFORDABILITY_ADJUST_STEPS`, `MIN_QUANTITY`, `DEFAULT_SPREAD_BPS`,
  `DEFAULT_SLIPPAGE_BPS`, `DEFAULT_FEE_RATE`, `DEFAULT_INITIAL_BALANCE`,
  `MAX_REQUESTED_RANGE_DAYS`, `CONFIG_BOUNDS` (object with `initialBalance`, `feeRate`,
  `spreadBps`, `slippageBps` min/max) — consumed by `sizing.ts` (Task 9), `fills.ts`
  (Task 12), and the API route (Task 21) for validation.

- [ ] **Step 1: Write the failing test**

```ts
// pixel-office/tests/backtest-config.test.ts
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
    expect(MIN_QUANTITY.toString()).toBe("0.00000001");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pixel-office && npx vitest run tests/backtest-config.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/config'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/config.ts
//
// Deterministic Phase 3 constants, copied verbatim from the approved design spec
// (docs/superpowers/specs/2026-07-15-trading-bot-phase3-backtesting-design.md §2/§2.1).
// MAX_AFFORDABILITY_ADJUST_STEPS must not change without separate explicit approval.
import { Prisma } from "@prisma/client";

export const RISK_PER_TRADE_FRACTION = new Prisma.Decimal("0.005");
export const PRIMARY_WARMUP_BARS = 60;
export const CONFIRMATION_WARMUP_BARS = 50;
export const MAX_AFFORDABILITY_ADJUST_STEPS = 8;
export const MIN_QUANTITY = new Prisma.Decimal("0.00000001");

export const DEFAULT_SPREAD_BPS = 5;
export const DEFAULT_SLIPPAGE_BPS = 5;
export const DEFAULT_FEE_RATE = new Prisma.Decimal("0.001");
export const DEFAULT_INITIAL_BALANCE = new Prisma.Decimal("10000");

export const MAX_REQUESTED_RANGE_DAYS = 365;

export const CONFIG_BOUNDS = {
  initialBalance: { min: 100, max: 1_000_000 },
  feeRate: { min: 0, max: 0.01 },
  spreadBps: { min: 0, max: 100 },
  slippageBps: { min: 0, max: 100 },
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pixel-office && npx vitest run tests/backtest-config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/config.ts pixel-office/tests/backtest-config.test.ts
git commit -m "feat(backtest): add Phase 3 config constants and bounds"
```

---

### Task 3: Decimal rounding helpers with monetary-parity tests

**Files:**
- Create: `pixel-office/lib/backtest/decimal.ts`
- Test: `pixel-office/tests/backtest-decimal.test.ts`

**Interfaces:**
- Consumes: nothing (uses `Prisma.Decimal` directly).
- Produces: `D8(x): Prisma.Decimal`, `Q8(x): Prisma.Decimal`, `ONE_QUANTITY_QUANTUM:
  Prisma.Decimal` — every monetary/quantity computation in Tasks 8–19 goes through
  these two functions exclusively.

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-decimal.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { D8, Q8, ONE_QUANTITY_QUANTUM } from "@/lib/backtest/decimal";

// Mirrors lib/trading-bot/mock-broker.ts's private `rounded()` helper exactly
// (8dp, ROUND_HALF_UP) — D8 must never diverge from the accepted Phase 1 convention.
function acceptedMonetaryRounding(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}

describe("D8 parity with the accepted Phase 1 monetary rounding convention", () => {
  const fixtures = [
    "1.123456785",
    "0.000000005",
    "100000.999999995",
    "0",
    "-5.123456785",
    "0.123456784",
    "12345.123456786",
  ];

  it("matches lib/trading-bot/mock-broker.ts's rounded() on every shared fixture", () => {
    for (const f of fixtures) {
      expect(D8(f).toString()).toBe(acceptedMonetaryRounding(new Prisma.Decimal(f)).toString());
    }
  });

  it("rounds half up at the 8th decimal place", () => {
    expect(D8("1.000000005").toString()).toBe("1.00000001");
    expect(D8("1.000000004").toString()).toBe("1.00000000");
  });
});

describe("Q8 quantity rounding (floor, never up)", () => {
  it("truncates toward zero at 8dp regardless of the 9th digit", () => {
    expect(Q8("1.999999999").toString()).toBe("1.99999999");
    expect(Q8("1.999999991").toString()).toBe("1.99999999");
  });

  it("floors a sub-quantum value to exactly zero", () => {
    expect(Q8("0.000000001").toString()).toBe("0");
  });

  it("never produces a value greater than the unrounded input", () => {
    const input = new Prisma.Decimal("42.123456789123");
    expect(Q8(input).lessThanOrEqualTo(input)).toBe(true);
  });
});

describe("ONE_QUANTITY_QUANTUM", () => {
  it("equals the smallest representable 8dp quantity", () => {
    expect(ONE_QUANTITY_QUANTUM.toString()).toBe("0.00000001");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-decimal.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/decimal'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/decimal.ts
//
// The ONLY two rounding operations used anywhere in lib/backtest/. D8 is used for
// every price/fee/cash/notional/P&L value; Q8 is used ONLY for quantity, and only
// ever floors — a floored quantity's cost can never exceed the budget it was sized
// from. D8 is verified (tests/backtest-decimal.test.ts) to match the accepted Phase 1
// monetary rounding convention in lib/trading-bot/mock-broker.ts's rounded() helper,
// without importing lib/trading-bot (kept out of lib/backtest/'s import graph).
import { Prisma } from "@prisma/client";

export function D8(x: Prisma.Decimal | number | string): Prisma.Decimal {
  return new Prisma.Decimal(x).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}

export function Q8(x: Prisma.Decimal | number | string): Prisma.Decimal {
  return new Prisma.Decimal(x).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
}

export const ONE_QUANTITY_QUANTUM = new Prisma.Decimal("0.00000001");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-decimal.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/decimal.ts pixel-office/tests/backtest-decimal.test.ts
git commit -m "feat(backtest): add D8/Q8 decimal helpers with monetary parity tests"
```

---

### Task 4: Historical candle validation (OHLC sanity, grid, duplicates, gaps, coverage)

**Files:**
- Create: `pixel-office/lib/backtest/validate-candles.ts`
- Test: `pixel-office/tests/backtest-validate-candles.test.ts`

**Interfaces:**
- Consumes: `type { Candle }` from `@/lib/market-data/candles`; `DataQualityReport`
  from `./types` (Task 1).
- Produces: `validateCandles(candles: Candle[], durationMs: number):
  { candles: Candle[]; report: Omit<DataQualityReport, "malformedCount" |
  "coverageShortfall"> }` and `checkCoverage(candles: Candle[], fetchStartTime: number,
  fetchEndTime: number, durationMs: number): DataQualityReport["coverageShortfall"]` —
  both consumed by `run-backtest.ts` (Task 16) to assemble the final `DataQualityReport`
  together with the fetch-layer `malformedCount` from `historical-candles.ts` (Task 6).

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-validate-candles.test.ts
import { describe, it, expect } from "vitest";
import type { Candle } from "@/lib/market-data/candles";
import { validateCandles, checkCoverage } from "@/lib/backtest/validate-candles";

const H = 3_600_000; // 1h duration, used as durationMs for compact fixtures
function c(openTime: number, open: number, high: number, low: number, close: number, volume = 1): Candle {
  return { openTime, open, high, low, close, volume };
}

describe("validateCandles — OHLC sanity", () => {
  it("drops a row where low > high, and counts it", () => {
    const { candles, report } = validateCandles(
      [c(0, 10, 9, 11, 10), c(H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.length).toBe(1);
    expect(report.invalidOhlcCount).toBe(1);
  });

  it("drops a row with a non-positive price or negative volume", () => {
    const { candles, report } = validateCandles(
      [c(0, 0, 1, 0, 1), c(H, 1, 1, 1, 1, -5), c(2 * H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.length).toBe(1);
    expect(report.invalidOhlcCount).toBe(2);
  });

  it("drops a row whose open/close falls outside [low, high]", () => {
    const { candles, report } = validateCandles(
      [c(0, 15, 12, 8, 10), c(H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.length).toBe(1);
    expect(report.invalidOhlcCount).toBe(1);
  });
});

describe("validateCandles — grid alignment", () => {
  it("rejects a row whose openTime does not align to durationMs", () => {
    const { candles, report } = validateCandles(
      [c(0, 10, 12, 8, 11), c(H + 1, 10, 12, 8, 11), c(2 * H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.map((x) => x.openTime)).toEqual([0, 2 * H]);
    expect(report.invalidOhlcCount).toBe(1);
  });
});

describe("validateCandles — sort/reorder reporting", () => {
  it("sorts unordered input and reports the reorder", () => {
    const { candles, report } = validateCandles(
      [c(2 * H, 10, 12, 8, 11), c(0, 10, 12, 8, 11), c(H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.map((x) => x.openTime)).toEqual([0, H, 2 * H]);
    expect(report.reordered).toBe(true);
    expect(report.reorderCount).toBeGreaterThan(0);
  });

  it("does not flag already-sorted input as reordered", () => {
    const { report } = validateCandles([c(0, 10, 12, 8, 11), c(H, 10, 12, 8, 11)], H);
    expect(report.reordered).toBe(false);
    expect(report.reorderCount).toBe(0);
  });
});

describe("validateCandles — duplicate timestamps", () => {
  it("collapses byte-identical duplicates with a warning count, keeping one row", () => {
    const { candles, report } = validateCandles(
      [c(0, 10, 12, 8, 11), c(0, 10, 12, 8, 11), c(H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.length).toBe(2);
    expect(report.exactDuplicateCount).toBe(1);
    expect(report.conflictingDuplicateCount).toBe(0);
  });

  it("counts conflicting duplicates (same timestamp, different OHLCV) without silently picking one", () => {
    const { report } = validateCandles(
      [c(0, 10, 12, 8, 11), c(0, 99, 100, 98, 99), c(H, 10, 12, 8, 11)],
      H,
    );
    expect(report.conflictingDuplicateCount).toBe(2);
    expect(report.exactDuplicateCount).toBe(0);
  });
});

describe("validateCandles — gap detection", () => {
  it("records a gap between non-contiguous consecutive candles, never interpolating", () => {
    const { candles, report } = validateCandles(
      [c(0, 10, 12, 8, 11), c(3 * H, 10, 12, 8, 11)],
      H,
    );
    expect(candles.length).toBe(2); // no synthetic candle inserted
    expect(report.gapCount).toBe(2); // two missing bars (at H and 2H)
    expect(report.gaps).toEqual([{ after: 0, before: 3 * H, missingBars: 2 }]);
  });

  it("reports zero gaps for a fully contiguous series", () => {
    const { report } = validateCandles([c(0, 10, 12, 8, 11), c(H, 10, 12, 8, 11)], H);
    expect(report.gapCount).toBe(0);
    expect(report.gaps).toEqual([]);
  });
});

describe("checkCoverage", () => {
  it("returns null when the fetched range fully covers the requested window", () => {
    const candles = [c(0, 10, 12, 8, 11), c(H, 10, 12, 8, 11), c(2 * H, 10, 12, 8, 11)];
    expect(checkCoverage(candles, 0, 2 * H, H)).toBeNull();
  });

  it("reports a shortfall when the fetched data starts later than requested", () => {
    const candles = [c(5 * H, 10, 12, 8, 11)];
    const shortfall = checkCoverage(candles, 0, 6 * H, H);
    expect(shortfall).not.toBeNull();
    expect(shortfall!.actualStart).toBe(5 * H);
  });

  it("reports a shortfall (empty result) when no candles were returned at all", () => {
    const shortfall = checkCoverage([], 0, 6 * H, H);
    expect(shortfall).toEqual({ requestedStart: 0, requestedEnd: 6 * H, actualStart: null, actualEnd: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-validate-candles.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/validate-candles'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/validate-candles.ts
//
// Historical candle validation policy (spec §13). Operates on already-parsed Candle[]
// arrays (raw-row parsing/numeric-finiteness happens in lib/market-data/
// historical-candles.ts, which is outside this module's import graph). Pure,
// deterministic, no I/O.
import type { Candle } from "@/lib/market-data/candles";
import type { DataQualityReport } from "./types";

export interface ValidatedCandles {
  candles: Candle[];
  report: Omit<DataQualityReport, "malformedCount" | "coverageShortfall">;
}

function isOhlcSane(c: Candle): boolean {
  return (
    c.low <= c.high &&
    c.open >= c.low &&
    c.open <= c.high &&
    c.close >= c.low &&
    c.close <= c.high &&
    c.open > 0 &&
    c.high > 0 &&
    c.low > 0 &&
    c.close > 0 &&
    c.volume >= 0
  );
}

export function validateCandles(candles: Candle[], durationMs: number): ValidatedCandles {
  // 1. OHLC sanity + grid alignment — both rejected into invalidOhlcCount per spec §13.
  let invalidOhlcCount = 0;
  const sane: Candle[] = [];
  for (const c of candles) {
    if (isOhlcSane(c) && c.openTime % durationMs === 0) {
      sane.push(c);
    } else {
      invalidOhlcCount++;
    }
  }

  // 2. Sort ascending by openTime; detect whether input was already sorted.
  const sorted = [...sane].sort((a, b) => a.openTime - b.openTime);
  let reorderCount = 0;
  for (let i = 0; i < sane.length; i++) {
    if (sane[i] !== sorted[i]) reorderCount++;
  }
  const reordered = reorderCount > 0;

  // 3. Duplicate timestamps: byte-identical collapse with a warning; conflicting fail.
  const byTime = new Map<number, Candle[]>();
  for (const c of sorted) {
    const group = byTime.get(c.openTime) ?? [];
    group.push(c);
    byTime.set(c.openTime, group);
  }
  let exactDuplicateCount = 0;
  let conflictingDuplicateCount = 0;
  const deduped: Candle[] = [];
  for (const openTime of [...byTime.keys()].sort((a, b) => a - b)) {
    const group = byTime.get(openTime)!;
    if (group.length === 1) {
      deduped.push(group[0]);
      continue;
    }
    const first = group[0];
    const allIdentical = group.every(
      (c) => c.open === first.open && c.high === first.high && c.low === first.low && c.close === first.close && c.volume === first.volume,
    );
    if (allIdentical) {
      exactDuplicateCount += group.length - 1;
      deduped.push(first);
    } else {
      conflictingDuplicateCount += group.length;
    }
  }

  // 4. Gap detection — never interpolated.
  const gaps: DataQualityReport["gaps"] = [];
  let gapCount = 0;
  for (let i = 0; i < deduped.length - 1; i++) {
    const delta = deduped[i + 1].openTime - deduped[i].openTime;
    if (delta !== durationMs) {
      const missingBars = Math.round(delta / durationMs) - 1;
      gaps.push({ after: deduped[i].openTime, before: deduped[i + 1].openTime, missingBars });
      gapCount += missingBars;
    }
  }

  return {
    candles: deduped,
    report: { invalidOhlcCount, exactDuplicateCount, conflictingDuplicateCount, reordered, reorderCount, gapCount, gaps },
  };
}

/**
 * Post-pagination coverage check (spec §5.3). Returns null when the fetched candles
 * cover the requested [fetchStartTime, fetchEndTime) window (within one bar's slack at
 * each edge, to tolerate grid rounding); otherwise returns the shortfall detail.
 */
export function checkCoverage(
  candles: Candle[],
  fetchStartTime: number,
  fetchEndTime: number,
  durationMs: number,
): DataQualityReport["coverageShortfall"] {
  if (candles.length === 0) {
    return { requestedStart: fetchStartTime, requestedEnd: fetchEndTime, actualStart: null, actualEnd: null };
  }
  const actualStart = candles[0].openTime;
  const actualEnd = candles[candles.length - 1].openTime + durationMs;
  const shortfall = actualStart > fetchStartTime + durationMs || actualEnd < fetchEndTime - durationMs;
  if (!shortfall) return null;
  return { requestedStart: fetchStartTime, requestedEnd: fetchEndTime, actualStart, actualEnd };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-validate-candles.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/validate-candles.ts pixel-office/tests/backtest-validate-candles.test.ts
git commit -m "feat(backtest): add historical candle validation policy"
```

---

### Task 5: Date-range normalization and decision-bar/tradable-bar classification

**Files:**
- Create: `pixel-office/lib/backtest/candle-window.ts`
- Test: `pixel-office/tests/backtest-candle-window.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TIMEFRAME_DURATION_MS_4H`, `EvaluationWindow` type, `normalizeRange(
  requestedStart, requestedEnd, latestFullyClosedBarBoundary): EvaluationWindow`,
  `isDecisionBar(closeTime, window): boolean`, `isTradableBar(openTime, closeTime,
  window): boolean`, `primaryFetchWindow`/`oneHourFetchWindow`/`oneDayFetchWindow(
  normalizedStart, normalizedEnd): { fetchStartTime: number; fetchEndTime: number }` —
  consumed by `historical-candles.ts` (Task 7) for fetch bounds and `simulate.ts`
  (Task 13) for per-bar classification.

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-candle-window.test.ts
import { describe, it, expect } from "vitest";
import {
  TIMEFRAME_DURATION_MS_4H,
  normalizeRange,
  isDecisionBar,
  isTradableBar,
  primaryFetchWindow,
  oneHourFetchWindow,
  oneDayFetchWindow,
} from "@/lib/backtest/candle-window";

const H4 = TIMEFRAME_DURATION_MS_4H; // 14,400,000

describe("normalizeRange", () => {
  it("rounds requestedStart UP and requestedEnd DOWN to the nearest 4h boundary", () => {
    const w = normalizeRange(1_000, H4 * 3 + 1_000, H4 * 10);
    expect(w.normalizedStart).toBe(H4); // ceil(1000/H4) * H4
    expect(w.normalizedEnd).toBe(H4 * 3); // floor((3*H4+1000)/H4) * H4
  });

  it("caps effectiveEndBoundary at latestFullyClosedBarBoundary when it is earlier", () => {
    const w = normalizeRange(0, H4 * 10, H4 * 4);
    expect(w.normalizedEnd).toBe(H4 * 10);
    expect(w.effectiveEndBoundary).toBe(H4 * 4);
  });

  it("leaves an already-boundary-aligned start/end unchanged", () => {
    const w = normalizeRange(H4 * 2, H4 * 5, H4 * 10);
    expect(w.normalizedStart).toBe(H4 * 2);
    expect(w.normalizedEnd).toBe(H4 * 5);
  });
});

// Worked example from spec §6.3: normalizedStart=08:00, effectiveEndBoundary=16:00
// (using H4-relative offsets: 08:00 == 2*H4 if the epoch origin is treated as 00:00).
describe("isDecisionBar / isTradableBar — spec §6.3 worked example", () => {
  const start = 2 * H4; // 08:00
  const end = 4 * H4; // 16:00 (effectiveEndBoundary)
  const window = { normalizedStart: start, normalizedEnd: end, effectiveEndBoundary: end };

  // Bar A: 04:00–08:00 (1*H4 to 2*H4)
  const A = { openTime: 1 * H4, closeTime: 2 * H4 };
  // Bar B: 08:00–12:00 (2*H4 to 3*H4)
  const B = { openTime: 2 * H4, closeTime: 3 * H4 };
  // Bar C: 12:00–16:00 (3*H4 to 4*H4)
  const C = { openTime: 3 * H4, closeTime: 4 * H4 };
  // Bar D (never fetched in production, but the classifier must still handle it):
  // 16:00–20:00 (4*H4 to 5*H4)
  const D = { openTime: 4 * H4, closeTime: 5 * H4 };

  it("Bar A is decision-only: produces the first signal, never tradable", () => {
    expect(isDecisionBar(A.closeTime, window)).toBe(true);
    expect(isTradableBar(A.openTime, A.closeTime, window)).toBe(false);
  });

  it("Bar B is both decision and tradable — the first tradable bar", () => {
    expect(isDecisionBar(B.closeTime, window)).toBe(true);
    expect(isTradableBar(B.openTime, B.closeTime, window)).toBe(true);
  });

  it("Bar C is tradable-only: valued/liquidated but produces no new signal", () => {
    expect(isDecisionBar(C.closeTime, window)).toBe(false);
    expect(isTradableBar(C.openTime, C.closeTime, window)).toBe(true);
  });

  it("Bar D is neither decision nor tradable — never eligible at/after the boundary", () => {
    expect(isDecisionBar(D.closeTime, window)).toBe(false);
    expect(isTradableBar(D.openTime, D.closeTime, window)).toBe(false);
  });

  it("a bar closing exactly at normalizedStart is a decision bar (boundary-inclusive)", () => {
    expect(isDecisionBar(start, window)).toBe(true);
  });

  it("a bar closing 1ms before normalizedStart is warm-up-only, not a decision bar", () => {
    expect(isDecisionBar(start - 1, window)).toBe(false);
  });
});

describe("fetch window helpers", () => {
  const normalizedStart = 100 * H4;
  const normalizedEnd = 110 * H4;

  it("primaryFetchWindow subtracts 60 bars of 4h pre-roll and ends 1ms before normalizedEnd", () => {
    const w = primaryFetchWindow(normalizedStart, normalizedEnd);
    expect(w.fetchStartTime).toBe(normalizedStart - 60 * H4);
    expect(w.fetchEndTime).toBe(normalizedEnd - 1);
  });

  it("oneHourFetchWindow subtracts 50 bars of 1h pre-roll", () => {
    const w = oneHourFetchWindow(normalizedStart, normalizedEnd);
    expect(w.fetchStartTime).toBe(normalizedStart - 50 * 3_600_000);
    expect(w.fetchEndTime).toBe(normalizedEnd - 1);
  });

  it("oneDayFetchWindow subtracts 50 bars of 1d pre-roll", () => {
    const w = oneDayFetchWindow(normalizedStart, normalizedEnd);
    expect(w.fetchStartTime).toBe(normalizedStart - 50 * 86_400_000);
    expect(w.fetchEndTime).toBe(normalizedEnd - 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-candle-window.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/candle-window'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/candle-window.ts
//
// Date-range normalization and the corrected decision-bar/tradable-bar boundary model
// (spec §6). Pure, deterministic, no I/O, no wall clock — every timestamp is a
// parameter.
export const TIMEFRAME_DURATION_MS_4H = 14_400_000;
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

export const PRIMARY_WARMUP_BARS = 60;
export const CONFIRMATION_WARMUP_BARS = 50;

export interface EvaluationWindow {
  normalizedStart: number;
  normalizedEnd: number;
  effectiveEndBoundary: number;
}

export function normalizeRange(
  requestedStart: number,
  requestedEnd: number,
  latestFullyClosedBarBoundary: number,
): EvaluationWindow {
  const normalizedStart = Math.ceil(requestedStart / TIMEFRAME_DURATION_MS_4H) * TIMEFRAME_DURATION_MS_4H;
  const normalizedEnd = Math.floor(requestedEnd / TIMEFRAME_DURATION_MS_4H) * TIMEFRAME_DURATION_MS_4H;
  const effectiveEndBoundary = Math.min(normalizedEnd, latestFullyClosedBarBoundary);
  return { normalizedStart, normalizedEnd, effectiveEndBoundary };
}

/** Step 5 (signal computation) runs only for decision bars. */
export function isDecisionBar(closeTime: number, window: EvaluationWindow): boolean {
  return closeTime >= window.normalizedStart && closeTime < window.effectiveEndBoundary;
}

/** Steps 1–4 (entry fill, gap exit, intrabar exit, equity mark) run only for tradable bars. */
export function isTradableBar(openTime: number, closeTime: number, window: EvaluationWindow): boolean {
  return (
    openTime >= window.normalizedStart &&
    openTime < window.effectiveEndBoundary &&
    closeTime <= window.effectiveEndBoundary
  );
}

export interface FetchWindow {
  fetchStartTime: number;
  fetchEndTime: number;
}

export function primaryFetchWindow(normalizedStart: number, normalizedEnd: number): FetchWindow {
  return {
    fetchStartTime: normalizedStart - PRIMARY_WARMUP_BARS * TIMEFRAME_DURATION_MS_4H,
    fetchEndTime: normalizedEnd - 1,
  };
}

export function oneHourFetchWindow(normalizedStart: number, normalizedEnd: number): FetchWindow {
  return {
    fetchStartTime: normalizedStart - CONFIRMATION_WARMUP_BARS * ONE_HOUR_MS,
    fetchEndTime: normalizedEnd - 1,
  };
}

export function oneDayFetchWindow(normalizedStart: number, normalizedEnd: number): FetchWindow {
  return {
    fetchStartTime: normalizedStart - CONFIRMATION_WARMUP_BARS * ONE_DAY_MS,
    fetchEndTime: normalizedEnd - 1,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-candle-window.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/candle-window.ts pixel-office/tests/backtest-candle-window.test.ts
git commit -m "feat(backtest): add date-range normalization and decision/tradable bar classification"
```

**Checkpoint 1 report gate:** before starting Checkpoint 2, run
`cd pixel-office && npx vitest run tests/backtest-*.test.ts && npx tsc --noEmit` and
confirm all green. Report: files created, commit hashes, test counts, and explicit
confirmation that `git status --short` still shows only
`M pixel-office/components/portfolio/ui.tsx` as pre-existing/untouched plus this
checkpoint's new files.

## Checkpoint 2 — Pagination, Coverage, Deadlines, and Cancellation

### Task 6: Single-timeframe paginated MEXC fetch with cursor guards and bounded retry

**Files:**
- Create: `pixel-office/lib/market-data/historical-candles.ts`
- Test: `pixel-office/tests/historical-candles.test.ts`

**Interfaces:**
- Consumes: `import { TIMEFRAME_DURATION_MS } from "@/lib/trading-signals/candle-closed"`
  (already exported), `type { Timeframe }` from `@/lib/trading-signals/types`,
  `type { Candle }` from `./candles`.
- Produces: `PaginatedFetchResult` type, `fetchHistoricalCandles(symbol: string,
  timeframe: Timeframe, fetchStartTime: number, fetchEndTime: number, signal?:
  AbortSignal): Promise<PaginatedFetchResult>` — consumed by Task 7's 3-timeframe
  orchestrator. **This file must never be imported by anything under `lib/backtest/`**
  (safety boundary, spec §19; verified in Task 22).

Deterministic tests in this task mock `global.fetch` — no real network call, no real
wall clock (all timestamps are fixed literals). The one real-network test lives in
Task 8, clearly separated.

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/historical-candles.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchHistoricalCandles } from "@/lib/market-data/historical-candles";

const H = 3_600_000; // 1h duration for compact fixtures

function row(openTime: number, close = 100): unknown[] {
  return [openTime, close, close + 1, close - 1, close, "10", openTime + H, "1000"];
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as unknown as Response;
}

describe("fetchHistoricalCandles — single page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns all rows from a single page under the 500-row cap", async () => {
    const rows = [row(0), row(H), row(2 * H)];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(rows));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 3 * H - 1);

    expect(result.failed).toBe(false);
    expect(result.candles.map((c) => c.openTime)).toEqual([0, H, 2 * H]);
  });

  it("drops malformed rows and counts them", async () => {
    const rows = [row(0), ["not", "a", "candle"], row(H)];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(rows));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 2 * H - 1);

    expect(result.candles.length).toBe(2);
    expect(result.malformedCount).toBe(1);
  });

  it("reports failed=true on a non-200 response without throwing", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([], false));
    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, H);
    expect(result.failed).toBe(true);
  });
});

describe("fetchHistoricalCandles — pagination across pages", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("advances the cursor past the last row of a full (500-row) page", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => row(i * H));
    const page2 = [row(500 * H), row(501 * H)];
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(page1)).mockResolvedValueOnce(jsonResponse(page2));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 502 * H - 1);

    expect(result.candles.length).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondCallUrl).toContain(`startTime=${500 * H}`);
  });

  it("stops without a second request when a page returns fewer than 500 rows", async () => {
    const page1 = [row(0), row(H)];
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(page1));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 2 * H - 1);

    expect(result.candles.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes an overlapping page instead of duplicating rows", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => row(i * H));
    // page2 overlaps: repeats the last 2 rows of page1 before advancing.
    const page2 = [row(498 * H), row(499 * H), row(500 * H)];
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(page1)).mockResolvedValueOnce(jsonResponse(page2));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 501 * H - 1);

    const openTimes = result.candles.map((c) => c.openTime);
    expect(openTimes.length).toBe(new Set(openTimes).size); // no duplicate openTime
    expect(openTimes[openTimes.length - 1]).toBe(500 * H);
  });

  it("fails with PAGINATION_CURSOR_STUCK when a page is byte-identical to the previous one", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => row(i * H));
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(page1)).mockResolvedValueOnce(jsonResponse(page1));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 1000 * H - 1);

    expect(result.failed).toBe(true);
    expect(result.failureReason).toBe("PAGINATION_CURSOR_STUCK");
  });

  it("truncates and reports it after MAX_PAGES_PER_TIMEFRAME (20) full pages", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    for (let p = 0; p < 25; p++) {
      const page = Array.from({ length: 500 }, (_, i) => row((p * 500 + i) * H));
      fetchMock.mockResolvedValueOnce(jsonResponse(page));
    }
    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, 20_000 * H - 1);

    expect(result.truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});

describe("fetchHistoricalCandles — retry and cancellation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries exactly once on a network throw, then succeeds", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(jsonResponse([row(0)]));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, H - 1);

    expect(result.failed).toBe(false);
    expect(result.candles.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails after the network throws twice in a row (retry exhausted)", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error("network down")).mockRejectedValueOnce(new Error("still down"));

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, H - 1);

    expect(result.failed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops immediately and reports failed when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    const result = await fetchHistoricalCandles("BTCUSDT", "1h", 0, H - 1, controller.signal);

    expect(result.failed).toBe(true);
    expect(result.failureReason).toBe("CANCELLED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/historical-candles.test.ts`
Expected: FAIL — `Cannot find module '@/lib/market-data/historical-candles'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/market-data/historical-candles.ts
//
// Paginated, bounded, read-only public MEXC klines fetch for backtesting. Isolated
// from lib/backtest/ — never imported by it (spec §19). Empirically verified contract
// (spec §5.1, session of 2026-07-15): startTime/endTime are honored; limit is capped
// server-side at 500 rows regardless of the requested value; this is NOT a documented
// guarantee — re-verify if production behavior ever looks inconsistent with this file.
import type { Timeframe } from "@/lib/trading-signals/types";
import { TIMEFRAME_DURATION_MS } from "@/lib/trading-signals/candle-closed";
import type { Candle } from "./candles";

const KLINES_HOST = "https://api.mexc.com";
const INTERVAL_MAP: Record<Timeframe, string> = { "1h": "60m", "4h": "4h", "1d": "1d" };
const PAGE_LIMIT = 500;
export const MAX_PAGES_PER_TIMEFRAME = 20;
const PAGE_TIMEOUT_MS = 6_000;

export interface PaginatedFetchResult {
  candles: Candle[];
  malformedCount: number;
  truncated: boolean;
  failed: boolean;
  failureReason?: "CANCELLED" | "PAGE_FETCH_FAILED" | "PAGINATION_CURSOR_STUCK";
}

function parseRow(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const openTime = Number(row[0]);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);
  if (![openTime, open, high, low, close, volume].every((n) => Number.isFinite(n))) return null;
  return { openTime, open, high, low, close, volume };
}

async function fetchPage(
  symbol: string,
  timeframe: Timeframe,
  startTime: number,
  endTime: number,
  signal: AbortSignal | undefined,
): Promise<{ candles: Candle[]; malformedCount: number } | null> {
  const interval = INTERVAL_MAP[timeframe];
  const url = `${KLINES_HOST}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${PAGE_LIMIT}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return null;
    const candles: Candle[] = [];
    let malformedCount = 0;
    for (const row of body) {
      const c = parseRow(row);
      if (c) candles.push(c);
      else malformedCount++;
    }
    candles.sort((a, b) => a.openTime - b.openTime);
    return { candles, malformedCount };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

async function fetchPageWithRetry(
  symbol: string,
  timeframe: Timeframe,
  startTime: number,
  endTime: number,
  signal: AbortSignal | undefined,
): Promise<{ candles: Candle[]; malformedCount: number } | null> {
  const first = await fetchPage(symbol, timeframe, startTime, endTime, signal);
  if (first !== null) return first;
  if (signal?.aborted) return null;
  return fetchPage(symbol, timeframe, startTime, endTime, signal); // exactly one retry
}

export async function fetchHistoricalCandles(
  symbol: string,
  timeframe: Timeframe,
  fetchStartTime: number,
  fetchEndTime: number,
  signal?: AbortSignal,
): Promise<PaginatedFetchResult> {
  if (signal?.aborted) {
    return { candles: [], malformedCount: 0, truncated: false, failed: true, failureReason: "CANCELLED" };
  }

  const duration = TIMEFRAME_DURATION_MS[timeframe];
  let cursor = fetchStartTime;
  let allCandles: Candle[] = [];
  let malformedCount = 0;
  let pageCount = 0;
  let previousLastOpenTime: number | null = null;
  let previousSignature: string | null = null;

  while (cursor <= fetchEndTime) {
    if (signal?.aborted) {
      return { candles: allCandles, malformedCount, truncated: false, failed: true, failureReason: "CANCELLED" };
    }
    if (pageCount >= MAX_PAGES_PER_TIMEFRAME) {
      return { candles: allCandles, malformedCount, truncated: true, failed: false };
    }

    let page = await fetchPageWithRetry(symbol, timeframe, cursor, fetchEndTime, signal);
    if (page === null) {
      return { candles: allCandles, malformedCount, truncated: false, failed: true, failureReason: "PAGE_FETCH_FAILED" };
    }
    pageCount++;

    if (page.candles.length === 0) {
      // Structurally near the requested end -> genuine completion, not a suspicious gap.
      return { candles: allCandles, malformedCount: malformedCount + page.malformedCount, truncated: false, failed: false };
    }

    malformedCount += page.malformedCount;
    const firstOpenTime = page.candles[0].openTime;
    const lastOpenTime = page.candles[page.candles.length - 1].openTime;
    const signature = `${firstOpenTime}:${lastOpenTime}:${page.candles.length}`;

    if (previousLastOpenTime !== null && firstOpenTime <= previousLastOpenTime) {
      if (signature === previousSignature) {
        return { candles: allCandles, malformedCount, truncated: false, failed: true, failureReason: "PAGINATION_CURSOR_STUCK" };
      }
      page = { ...page, candles: page.candles.filter((c) => c.openTime > previousLastOpenTime!) };
      if (page.candles.length === 0) {
        return { candles: allCandles, malformedCount, truncated: false, failed: true, failureReason: "PAGINATION_CURSOR_STUCK" };
      }
    }

    allCandles = allCandles.concat(page.candles);
    previousLastOpenTime = page.candles[page.candles.length - 1].openTime;
    previousSignature = signature;

    if (page.candles.length < PAGE_LIMIT) {
      return { candles: allCandles, malformedCount, truncated: false, failed: false };
    }
    cursor = previousLastOpenTime + duration;
  }

  return { candles: allCandles, malformedCount, truncated: false, failed: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/historical-candles.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/market-data/historical-candles.ts pixel-office/tests/historical-candles.test.ts
git commit -m "feat(backtest): add paginated MEXC historical candle fetch with cursor guards"
```

---

### Task 7: Three-timeframe fetch orchestration with warm-up windows and coverage validation

**Files:**
- Modify: `pixel-office/lib/market-data/historical-candles.ts` (append)
- Test: `pixel-office/tests/historical-candles-orchestration.test.ts`

**Interfaces:**
- Consumes: `fetchHistoricalCandles` (Task 6); `primaryFetchWindow`/
  `oneHourFetchWindow`/`oneDayFetchWindow` from `@/lib/backtest/candle-window` (Task 5);
  `checkCoverage` from `@/lib/backtest/validate-candles` (Task 4).
- Produces: `HistoricalFetchBundle` type, `fetchBacktestHistory(ticker: string,
  normalizedStart: number, normalizedEnd: number, signal?: AbortSignal):
  Promise<HistoricalFetchBundle>` — consumed by the API route (Task 21).

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/historical-candles-orchestration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchBacktestHistory } from "@/lib/market-data/historical-candles";

const H4 = 14_400_000;

function row(openTime: number): unknown[] {
  return [openTime, 100, 101, 99, 100, "10", openTime + H4, "1000"];
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as unknown as Response;
}

describe("fetchBacktestHistory", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([row(0)])));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches primary, 1h, and 1d concurrently and returns all three results", async () => {
    const bundle = await fetchBacktestHistory("BTCUSDT", 100 * H4, 110 * H4);
    expect(bundle.primary).toBeDefined();
    expect(bundle.oneHour).toBeDefined();
    expect(bundle.oneDay).toBeDefined();
  });

  it("requests each timeframe with its own warm-up-extended start time", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    await fetchBacktestHistory("BTCUSDT", 100 * H4, 110 * H4);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("interval=4h") && u.includes(`startTime=${100 * H4 - 60 * H4}`))).toBe(true);
    expect(urls.some((u) => u.includes("interval=60m") && u.includes(`startTime=${100 * H4 - 50 * 3_600_000}`))).toBe(true);
    expect(urls.some((u) => u.includes("interval=1d") && u.includes(`startTime=${100 * H4 - 50 * 86_400_000}`))).toBe(true);
  });

  it("propagates a shared AbortSignal to every timeframe's fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    const bundle = await fetchBacktestHistory("BTCUSDT", 100 * H4, 110 * H4, controller.signal);
    expect(bundle.primary.failed).toBe(true);
    expect(bundle.oneHour.failed).toBe(true);
    expect(bundle.oneDay.failed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/historical-candles-orchestration.test.ts`
Expected: FAIL — `fetchBacktestHistory` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `pixel-office/lib/market-data/historical-candles.ts`:

```ts
import {
  primaryFetchWindow,
  oneHourFetchWindow,
  oneDayFetchWindow,
} from "@/lib/backtest/candle-window";

export interface HistoricalFetchBundle {
  primary: PaginatedFetchResult;
  oneHour: PaginatedFetchResult;
  oneDay: PaginatedFetchResult;
}

/**
 * Fetches primary (4h) + 1h + 1d confirmation history for a backtest run, each
 * extended by its own warm-up pre-roll (spec §6.2), concurrently, sharing one
 * AbortSignal. Never throws — failures are reported per-timeframe in the bundle.
 */
export async function fetchBacktestHistory(
  ticker: string,
  normalizedStart: number,
  normalizedEnd: number,
  signal?: AbortSignal,
): Promise<HistoricalFetchBundle> {
  const primaryWindow = primaryFetchWindow(normalizedStart, normalizedEnd);
  const oneHourWindow = oneHourFetchWindow(normalizedStart, normalizedEnd);
  const oneDayWindow = oneDayFetchWindow(normalizedStart, normalizedEnd);

  const [primary, oneHour, oneDay] = await Promise.all([
    fetchHistoricalCandles(ticker, "4h", primaryWindow.fetchStartTime, primaryWindow.fetchEndTime, signal),
    fetchHistoricalCandles(ticker, "1h", oneHourWindow.fetchStartTime, oneHourWindow.fetchEndTime, signal),
    fetchHistoricalCandles(ticker, "1d", oneDayWindow.fetchStartTime, oneDayWindow.fetchEndTime, signal),
  ]);

  return { primary, oneHour, oneDay };
}
```

Note: this creates an import from `lib/market-data/historical-candles.ts` INTO
`lib/backtest/candle-window.ts` — the reverse of the forbidden direction (spec §19
forbids `lib/backtest/` importing the fetch module; a fetch module importing a pure,
side-effect-free constant/classification helper from `lib/backtest/` is fine, but to
keep the safety-scan story simple and avoid any future confusion, duplicate the three
tiny window functions' math inline here instead of importing them, since they are pure
one-line arithmetic. Replace the `import { primaryFetchWindow, ... }` line above with:

```ts
const H4 = 14_400_000;
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

function primaryFetchWindow(normalizedStart: number, normalizedEnd: number) {
  return { fetchStartTime: normalizedStart - 60 * H4, fetchEndTime: normalizedEnd - 1 };
}
function oneHourFetchWindow(normalizedStart: number, normalizedEnd: number) {
  return { fetchStartTime: normalizedStart - 50 * ONE_HOUR_MS, fetchEndTime: normalizedEnd - 1 };
}
function oneDayFetchWindow(normalizedStart: number, normalizedEnd: number) {
  return { fetchStartTime: normalizedStart - 50 * ONE_DAY_MS, fetchEndTime: normalizedEnd - 1 };
}
```

(This intentionally duplicates the three constants also defined in
`lib/backtest/candle-window.ts` — a deliberate, tiny, one-directional duplication that
keeps the safety boundary a simple "one-directional import ban" rather than requiring a
third shared module. If `PRIMARY_WARMUP_BARS`/`CONFIRMATION_WARMUP_BARS` ever change,
both copies must be updated together — call this out in Task 22's safety-test docstring.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/historical-candles-orchestration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/market-data/historical-candles.ts pixel-office/tests/historical-candles-orchestration.test.ts
git commit -m "feat(backtest): orchestrate 3-timeframe historical fetch with warm-up windows"
```

---

### Task 8: Cumulative deadline helper + separate, bounded, read-only live-provider test

**Files:**
- Create: `pixel-office/lib/api/deadline.ts`
- Test: `pixel-office/tests/api-deadline.test.ts`
- Create: `pixel-office/tests/live/historical-candles.live.test.ts` (excluded from the
  default `npm test` run — see Step 3b)

**Interfaces:**
- Produces: `raceWithDeadline<T>(promise: Promise<T>, ms: number, onTimeout: () => T):
  Promise<T>` — consumed by the API route (Task 21) to enforce the 55s internal
  deadline around the historical-fetch phase.

- [ ] **Step 1: Write the failing test**

```ts
// pixel-office/tests/api-deadline.test.ts
import { describe, it, expect, vi } from "vitest";
import { raceWithDeadline } from "@/lib/api/deadline";

describe("raceWithDeadline", () => {
  it("resolves with the promise's value when it settles before the deadline", async () => {
    const result = await raceWithDeadline(Promise.resolve("done"), 1000, () => "timed-out");
    expect(result).toBe("done");
  });

  it("resolves with the timeout fallback when the promise is still pending at the deadline", async () => {
    vi.useFakeTimers();
    const neverResolves = new Promise<string>(() => {});
    const resultPromise = raceWithDeadline(neverResolves, 50, () => "timed-out");
    await vi.advanceTimersByTimeAsync(60);
    await expect(resultPromise).resolves.toBe("timed-out");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pixel-office && npx vitest run tests/api-deadline.test.ts`
Expected: FAIL — `Cannot find module '@/lib/api/deadline'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/api/deadline.ts
//
// Generic "resolve with a fallback if the promise takes too long" helper. Used to
// enforce the Phase 3 backtest route's internal deadline (spec §9.1: 55s, under the
// route's explicit 60s vercel.json maxDuration).
export function raceWithDeadline<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(onTimeout());
      },
    );
  });
}
```

- [ ] **Step 3b: Add the separate, bounded, read-only live-provider test**

This test makes ONE real request against the live MEXC endpoint to catch a genuine
contract regression (e.g. the empirically-observed 500-row cap changing). It is
deliberately isolated from the deterministic suite: create
`pixel-office/tests/live/` and exclude it from the default Vitest run.

```ts
// pixel-office/tests/live/historical-candles.live.test.ts
//
// LIVE, NETWORK-DEPENDENT test. Not part of `npm test` (excluded via vitest.config —
// see below). Run explicitly with `npm run test:live`. Bounded to ONE request, 10s
// timeout, read-only public endpoint — never blocks or flakes the normal suite.
import { describe, it, expect } from "vitest";
import { fetchHistoricalCandles } from "@/lib/market-data/historical-candles";

describe("live MEXC klines contract (network required)", () => {
  it(
    "still caps a request for >500 rows at exactly 500",
    async () => {
      const now = Date.now();
      const result = await fetchHistoricalCandles("BTCUSDT", "1h", now - 1000 * 3_600_000, now);
      expect(result.failed).toBe(false);
      expect(result.candles.length).toBeLessThanOrEqual(500);
    },
    10_000,
  );
});
```

Check `pixel-office/vitest.config.ts` (or `vite.config.ts` if Vitest config lives
there) for the `test.exclude` array; add `"tests/live/**"` to it so the default run
never touches the network, and add a `test:live` script to `package.json`:

```json
"scripts": {
  "test:live": "vitest run tests/live"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/api-deadline.test.ts`
Expected: PASS (2 tests).

Run: `cd pixel-office && npx vitest run tests/backtest-*.test.ts tests/historical-candles*.test.ts`
Expected: PASS, and `tests/live/` is NOT picked up by this run (confirm the exclude
pattern works: `cd pixel-office && npx vitest run` with no path arg must also skip it).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/api/deadline.ts pixel-office/tests/api-deadline.test.ts pixel-office/tests/live/historical-candles.live.test.ts pixel-office/vitest.config.ts pixel-office/package.json
git commit -m "feat(backtest): add cumulative deadline helper and isolated live-provider test"
```

**Checkpoint 2 report gate:** run
`cd pixel-office && npx vitest run tests/backtest-*.test.ts tests/historical-candles*.test.ts tests/api-deadline.test.ts && npx tsc --noEmit`
and confirm all green, and confirm `npx vitest run` (default, no path) does not execute
`tests/live/`. Report files/commits/test counts and reconfirm the
`portfolio/ui.tsx` working-tree change is still untouched.

## Checkpoint 3 — Execution, Sizing, Exits, Benchmark, and Metrics

### Task 9: Spread/slippage execution-price formulas and exit-trigger detection

**Files:**
- Create: `pixel-office/lib/backtest/fills.ts`
- Test: `pixel-office/tests/backtest-fills.test.ts`

**Interfaces:**
- Consumes: `D8` from `./decimal` (Task 3).
- Produces: `askPrice(rawMid: number, spreadBps: number, slippageBps: number):
  Prisma.Decimal`, `bidPrice(...): Prisma.Decimal`, `detectExitTrigger(barLow: number,
  barHigh: number, stopLoss: number, tp1: number): "STOP" | "TP1" | "NONE"`,
  `gapExitRawMid(barOpen: number, stopLoss: number, tp1: number): { trigger: "STOP" |
  "TP1"; rawMid: number } | null`, `computeExit(rawMid: number, spreadBps: number,
  slippageBps: number, feeRate: Prisma.Decimal, quantity: Prisma.Decimal, entryCost:
  Prisma.Decimal): { exitExecutionPrice, exitNotional, exitFee, exitProceeds,
  realizedPnl }` — all consumed by `simulate.ts` (Task 13) and `benchmark.ts` (Task 14).

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-fills.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { askPrice, bidPrice, detectExitTrigger, gapExitRawMid, computeExit } from "@/lib/backtest/fills";

describe("askPrice / bidPrice — spread and slippage stay separate but compound", () => {
  it("askPrice = mid * (1+spread/20000) * (1+slippage/10000)", () => {
    // spread=5bps -> +0.00025 ; slippage=5bps -> +0.0005
    expect(askPrice(100, 5, 5).toString()).toBe(
      new Prisma.Decimal(100).times(1.00025).times(1.0005).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP).toString(),
    );
  });

  it("bidPrice = mid * (1-spread/20000) * (1-slippage/10000)", () => {
    expect(bidPrice(100, 5, 5).toString()).toBe(
      new Prisma.Decimal(100).times(0.99975).times(0.9995).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP).toString(),
    );
  });

  it("spread-only (slippage=0) and slippage-only (spread=0) each apply independently", () => {
    expect(askPrice(100, 5, 0).toString()).toBe("100.02500000");
    expect(askPrice(100, 0, 5).toString()).toBe("100.05000000");
  });

  it("zero spread and zero slippage leaves the price unchanged", () => {
    expect(askPrice(100, 0, 0).toString()).toBe("100.00000000");
    expect(bidPrice(100, 0, 0).toString()).toBe("100.00000000");
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
    expect(result.exitExecutionPrice.toString()).toBe("105.00000000");
    expect(result.exitNotional.toString()).toBe("210.00000000");
    expect(result.exitFee.toString()).toBe("0.21000000");
    expect(result.exitProceeds.toString()).toBe("209.79000000");
    expect(result.realizedPnl.toString()).toBe("9.79000000");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-fills.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/fills'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/fills.ts
//
// Spread/slippage execution-price formulas (spec §8.2) and exit-trigger detection
// (spec §10). spreadBps and slippageBps stay two permanently separate config inputs —
// they are compounded into one effective adverse execution price per fill here, never
// represented as a single blended value upstream. Pure, deterministic, no I/O.
import { Prisma } from "@prisma/client";
import { D8 } from "./decimal";

export function askPrice(rawMid: number, spreadBps: number, slippageBps: number): Prisma.Decimal {
  return D8(
    new Prisma.Decimal(rawMid).times(1 + spreadBps / 20000).times(1 + slippageBps / 10000),
  );
}

export function bidPrice(rawMid: number, spreadBps: number, slippageBps: number): Prisma.Decimal {
  return D8(
    new Prisma.Decimal(rawMid).times(1 - spreadBps / 20000).times(1 - slippageBps / 10000),
  );
}

export type ExitTrigger = "STOP" | "TP1" | "NONE";

/** Stop-first, unconditionally, when both levels are touched in the same bar (spec §10.3). */
export function detectExitTrigger(barLow: number, barHigh: number, stopLoss: number, tp1: number): ExitTrigger {
  if (barLow <= stopLoss) return "STOP";
  if (barHigh >= tp1) return "TP1";
  return "NONE";
}

/** Open-based gap-through fill (spec §10.2) — fills at the bar's raw open, not the stale level. */
export function gapExitRawMid(
  barOpen: number,
  stopLoss: number,
  tp1: number,
): { trigger: Exclude<ExitTrigger, "NONE">; rawMid: number } | null {
  if (barOpen <= stopLoss) return { trigger: "STOP", rawMid: barOpen };
  if (barOpen >= tp1) return { trigger: "TP1", rawMid: barOpen };
  return null;
}

export interface ExitAccounting {
  exitExecutionPrice: Prisma.Decimal;
  exitNotional: Prisma.Decimal;
  exitFee: Prisma.Decimal;
  exitProceeds: Prisma.Decimal;
  realizedPnl: Prisma.Decimal;
}

/** Total-notional exit accounting (spec §8.4) — used for STOP, TP1, and END_OF_TEST exits alike. */
export function computeExit(
  rawMid: number,
  spreadBps: number,
  slippageBps: number,
  feeRate: Prisma.Decimal,
  quantity: Prisma.Decimal,
  entryCost: Prisma.Decimal,
): ExitAccounting {
  const exitExecutionPrice = bidPrice(rawMid, spreadBps, slippageBps);
  const exitNotional = D8(quantity.times(exitExecutionPrice));
  const exitFee = D8(exitNotional.times(feeRate));
  const exitProceeds = D8(exitNotional.minus(exitFee));
  const realizedPnl = D8(exitProceeds.minus(entryCost));
  return { exitExecutionPrice, exitNotional, exitFee, exitProceeds, realizedPnl };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-fills.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/fills.ts pixel-office/tests/backtest-fills.test.ts
git commit -m "feat(backtest): add spread/slippage execution-price and exit-trigger formulas"
```

---

### Task 10: Bounded cash-and-risk-budget sizing loop

**Files:**
- Create: `pixel-office/lib/backtest/sizing.ts`
- Test: `pixel-office/tests/backtest-sizing.test.ts`

**Interfaces:**
- Consumes: `D8`, `Q8`, `ONE_QUANTITY_QUANTUM` from `./decimal` (Task 3);
  `MAX_AFFORDABILITY_ADJUST_STEPS` from `./config` (Task 2).
- Produces: `SizingResult` type (`SizingAccept | SizingReject`),
  `sizeWithinCashAndRisk(initialQuantity: Prisma.Decimal, entryExecutionPrice:
  Prisma.Decimal, feeRate: Prisma.Decimal, availableCash: Prisma.Decimal, riskBudget:
  Prisma.Decimal | null, hypotheticalStopExecutionPrice: Prisma.Decimal | null):
  SizingResult` — consumed by `fills.ts`'s entry-validation orchestrator (Task 12) and
  `benchmark.ts` (Task 14, with `riskBudget = null`).

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-sizing.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { sizeWithinCashAndRisk } from "@/lib/backtest/sizing";

const feeRate = new Prisma.Decimal("0.001");

describe("sizeWithinCashAndRisk — accepts when both constraints hold", () => {
  it("accepts the initial quantity untouched when cash and risk are both ample", () => {
    const result = sizeWithinCashAndRisk(
      new Prisma.Decimal("1"), new Prisma.Decimal("100"), feeRate,
      new Prisma.Decimal("10000"), new Prisma.Decimal("500"), new Prisma.Decimal("90"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quantity.toString()).toBe("1");
      expect(result.entryCost.lessThanOrEqualTo("10000")).toBe(true);
      expect(result.actualNetRisk!.lessThanOrEqualTo("500")).toBe(true);
    }
  });
});

describe("sizeWithinCashAndRisk — cash boundary (rounding pushes cost over)", () => {
  it("decrements exactly once when ROUND_HALF_UP would push entryCost 1e-8 over availableCash", () => {
    // Choose a price/quantity where the unrounded cost is exactly at the cash limit,
    // but rounding the fee up by 1 unit at the 8th decimal tips it over.
    const price = new Prisma.Decimal("100.000000005"); // rounds to 100.00000001 on D8
    const quantity = new Prisma.Decimal("1");
    const notional = quantity.times(price); // 100.000000005
    const fee = notional.times(feeRate); // 0.100000000005 -> D8 rounds up to 0.10000000
    const trueCost = notional.plus(fee); // ~100.100000005 (unrounded)
    const availableCash = trueCost.toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN); // one 1e-8 short of the rounded cost

    const result = sizeWithinCashAndRisk(quantity, price, feeRate, availableCash, null, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quantity.toString()).toBe("0.99999999");
      expect(result.entryCost.lessThanOrEqualTo(availableCash)).toBe(true);
    }
  });

  it("rejects INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE when even the smallest quantum is unaffordable", () => {
    const result = sizeWithinCashAndRisk(
      new Prisma.Decimal("0.00000001"), new Prisma.Decimal("1000000"), feeRate,
      new Prisma.Decimal("0.001"), null, null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE");
  });
});

describe("sizeWithinCashAndRisk — risk-budget boundary (rounding pushes risk over)", () => {
  it("decrements until actualNetRisk <= riskBudget exactly, with no tolerance applied", () => {
    const entryPrice = new Prisma.Decimal("100");
    const stopPrice = new Prisma.Decimal("99.999999995"); // engineered so netRisk rounds up at the boundary
    const quantity = new Prisma.Decimal("1000"); // large per-unit-risk multiplier magnifies the rounding delta
    const riskBudget = quantity.times(entryPrice.minus(stopPrice)).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);

    const result = sizeWithinCashAndRisk(
      quantity, entryPrice, feeRate, new Prisma.Decimal("1000000"), riskBudget, stopPrice,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actualNetRisk!.lessThanOrEqualTo(riskBudget)).toBe(true);
    }
  });

  it("rejects RISK_BUDGET_UNREPRESENTABLE when cash is ample but risk cannot be satisfied within 8 steps", () => {
    const result = sizeWithinCashAndRisk(
      new Prisma.Decimal("1"), new Prisma.Decimal("100"), feeRate,
      new Prisma.Decimal("1000000"), new Prisma.Decimal("0.00000001"), new Prisma.Decimal("0"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("RISK_BUDGET_UNREPRESENTABLE");
  });
});

describe("sizeWithinCashAndRisk — cash-only mode (benchmark, riskBudget=null)", () => {
  it("ignores risk entirely and only enforces cash affordability", () => {
    const result = sizeWithinCashAndRisk(
      new Prisma.Decimal("50"), new Prisma.Decimal("100"), feeRate,
      new Prisma.Decimal("5000"), null, null,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actualNetRisk).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-sizing.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/sizing'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/sizing.ts
//
// Bounded cash-and-risk-budget adjustment loop (spec §8.4, corrected to a HARD cap —
// no tolerance constant, ever, without separate approval). Shared by strategy entry
// sizing (fills.ts, riskBudget != null) and benchmark sizing (benchmark.ts, riskBudget
// = null, cash-only). Pure, deterministic, no I/O.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-sizing.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/sizing.ts pixel-office/tests/backtest-sizing.test.ts
git commit -m "feat(backtest): add bounded cash-and-risk-budget sizing loop"
```

---

### Task 11: Property-style sizing sweep across the full configuration bound space

**Files:**
- Create: `pixel-office/tests/backtest-sizing-property.test.ts`

**Interfaces:**
- Consumes: `sizeWithinCashAndRisk` (Task 10); `CONFIG_BOUNDS` from `./config` (Task 2).

This task adds tests only — `sizing.ts` is already correct from Task 10; this proves it
holds across the whole supported input space, per the approved decision that
`MAX_AFFORDABILITY_ADJUST_STEPS` is backed by this sweep and must not be raised without
separate approval.

- [ ] **Step 1: Write the failing test**

```ts
// pixel-office/tests/backtest-sizing-property.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { sizeWithinCashAndRisk } from "@/lib/backtest/sizing";
import { CONFIG_BOUNDS, RISK_PER_TRADE_FRACTION } from "@/lib/backtest/config";

// Fixed grid, no randomness/fuzzing library: min/mid/max for each numeric bound,
// combined pairwise (not full cartesian) to keep the suite fast and deterministic.
const SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
const BALANCES = [CONFIG_BOUNDS.initialBalance.min, 50_000, CONFIG_BOUNDS.initialBalance.max];
const FEE_RATES = [CONFIG_BOUNDS.feeRate.min, 0.001, CONFIG_BOUNDS.feeRate.max];
const SPREADS = [CONFIG_BOUNDS.spreadBps.min, 5, CONFIG_BOUNDS.spreadBps.max];
const SLIPPAGES = [CONFIG_BOUNDS.slippageBps.min, 5, CONFIG_BOUNDS.slippageBps.max];
const PRICES = [0.01, 1, 100, 65000]; // representative price magnitudes across the whitelist

function pairwise<A, B>(as: A[], bs: B[]): [A, B][] {
  const out: [A, B][] = [];
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i++) out.push([as[i % as.length], bs[i % bs.length]]);
  return out;
}

describe("sizing property sweep — every accepted quantity satisfies both hard caps", () => {
  const combos = pairwise(BALANCES, FEE_RATES)
    .flatMap(([balance, fee]) => pairwise(SPREADS, SLIPPAGES).map(([spread, slip]) => ({ balance, fee, spread, slip })))
    .flatMap((c) => PRICES.map((price) => ({ ...c, price })));

  it.each(combos)(
    "balance=%o fee=%o spread=%o slippage=%o price=%o: accept implies both constraints hold; reject is always one of the three safe codes",
    ({ balance, fee, spread, slip, price }) => {
      const feeRate = new Prisma.Decimal(fee);
      const availableCash = new Prisma.Decimal(balance);
      const entryExecutionPrice = new Prisma.Decimal(price).times(1 + spread / 20000).times(1 + slip / 10000);
      const stopExecutionPrice = new Prisma.Decimal(price).times(0.98); // a plausible 2%-below stop
      const riskBudget = availableCash.times(RISK_PER_TRADE_FRACTION);
      const initialQuantity = availableCash.dividedBy(entryExecutionPrice.times(feeRate.plus(1))).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);

      const result = sizeWithinCashAndRisk(initialQuantity, entryExecutionPrice, feeRate, availableCash, riskBudget, stopExecutionPrice);

      if (result.ok) {
        expect(result.entryCost.lessThanOrEqualTo(availableCash)).toBe(true);
        expect(result.actualNetRisk === null || result.actualNetRisk.lessThanOrEqualTo(riskBudget)).toBe(true);
      } else {
        expect(["QUANTITY_TOO_SMALL", "INSUFFICIENT_FUNDS_FOR_MINIMUM_SIZE", "RISK_BUDGET_UNREPRESENTABLE"]).toContain(result.reason);
      }
    },
  );

  it("every whitelisted symbol is represented in the sweep (documentation check)", () => {
    expect(SYMBOLS).toEqual(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pixel-office && npx vitest run tests/backtest-sizing-property.test.ts`
Expected: FAIL only if Task 10's implementation has a gap — if Task 10 is correct this
should already PASS on first run (this task adds coverage, not new production code). If
it fails, the failure points at a real defect in `sizing.ts`; fix `sizing.ts`, not the
test.

- [ ] **Step 3: (only if needed) fix `lib/backtest/sizing.ts`**

If Step 2 reveals a failing combination, fix the loop in Task 10's `sizing.ts` — do not
weaken this test's assertions to force a pass.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pixel-office && npx vitest run tests/backtest-sizing-property.test.ts`
Expected: PASS (all generated cases + 1).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/tests/backtest-sizing-property.test.ts
git commit -m "test(backtest): add property-style sizing sweep across the full config bound space"
```

---

### Task 12: Complete entry-validation sequence

**Files:**
- Modify: `pixel-office/lib/backtest/fills.ts` (append)
- Test: `pixel-office/tests/backtest-entry-validation.test.ts`

**Interfaces:**
- Consumes: `askPrice`, `bidPrice` (Task 9); `sizeWithinCashAndRisk` (Task 10);
  `RISK_PER_TRADE_FRACTION` from `./config` (Task 2); `MIN_RR` — re-exported locally as
  a `const MIN_RR = 1.5` matching `lib/trading-signals/config.ts`'s value (kept as a
  literal here rather than imported, since `lib/trading-signals/config.ts` is on the
  allowed-import list but re-declaring the single number avoids any risk of a stray
  non-type import creeping into `lib/backtest/`'s scanned surface — confirmed safe
  either way by Task 22's test, but the literal is simpler).
- Produces: `EntrySignalLevels` type, `EntryValidationResult` type (`EntryAccept |
  EntryReject`), `validateAndSizeEntry(entryBarOpen: number, levels: EntrySignalLevels,
  spreadBps: number, slippageBps: number, feeRate: Prisma.Decimal, availableCash:
  Prisma.Decimal): EntryValidationResult` — consumed by `simulate.ts` (Task 13).

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-entry-validation.test.ts
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
    // entryZoneHigh set so that the raw open is inside, but askPrice pushes past it.
    const tightLevels = { ...baseLevels, entryZoneHigh: 100.02 };
    const r = validateAndSizeEntry(100, tightLevels, 100, 100, feeRate, cash); // large spread+slippage
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
    const r = validateAndSizeEntry(100, baseLevels, 5, 5, feeRate, new Prisma.Decimal("50"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cashCapped).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-entry-validation.test.ts`
Expected: FAIL — `validateAndSizeEntry` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `pixel-office/lib/backtest/fills.ts`:

```ts
import { sizeWithinCashAndRisk } from "./sizing";
import { RISK_PER_TRADE_FRACTION } from "./config";
import { Q8 } from "./decimal";
import type { RejectionReason } from "./types";

const MIN_RR = 1.5; // matches lib/trading-signals/config.ts's MIN_RR

export interface EntrySignalLevels {
  entryZoneLow: number;
  entryZoneHigh: number;
  stopLoss: number;
  takeProfit1: number;
}

export interface EntryAccept {
  ok: true;
  entryExecutionPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
  entryNotional: Prisma.Decimal;
  entryFee: Prisma.Decimal;
  entryCost: Prisma.Decimal;
  intendedRiskBudget: Prisma.Decimal;
  actualNetRisk: Prisma.Decimal;
  actualRiskFraction: number;
  cashCapped: boolean;
  netRiskReward: number;
}
export interface EntryReject {
  ok: false;
  reason: RejectionReason;
}
export type EntryValidationResult = EntryAccept | EntryReject;

/** Complete entry-validation sequence (spec §8.3), steps 2–15 (contiguity, step 1, is
 *  the caller's responsibility — simulate.ts — since it concerns bar-index adjacency,
 *  not price levels). */
export function validateAndSizeEntry(
  entryBarOpen: number,
  levels: EntrySignalLevels,
  spreadBps: number,
  slippageBps: number,
  feeRate: Prisma.Decimal,
  availableCash: Prisma.Decimal,
): EntryValidationResult {
  if (entryBarOpen <= levels.stopLoss) return { ok: false, reason: "GAP_THROUGH_STOP" };
  if (entryBarOpen >= levels.takeProfit1) return { ok: false, reason: "GAP_THROUGH_TARGET" };
  if (entryBarOpen < levels.entryZoneLow || entryBarOpen > levels.entryZoneHigh) {
    return { ok: false, reason: "ENTRY_ZONE_MISSED" };
  }

  const entryExecutionPrice = askPrice(entryBarOpen, spreadBps, slippageBps);
  const zoneLow = new Prisma.Decimal(levels.entryZoneLow);
  const zoneHigh = new Prisma.Decimal(levels.entryZoneHigh);
  if (entryExecutionPrice.lessThan(zoneLow) || entryExecutionPrice.greaterThan(zoneHigh)) {
    return { ok: false, reason: "ENTRY_ZONE_MISSED_AFTER_COSTS" };
  }

  const stopLoss = new Prisma.Decimal(levels.stopLoss);
  const tp1 = new Prisma.Decimal(levels.takeProfit1);
  if (!(stopLoss.lessThan(entryExecutionPrice) && entryExecutionPrice.lessThan(tp1))) {
    return { ok: false, reason: "COST_ADJUSTED_ENTRY_INVALID" };
  }

  const hypotheticalStopExecutionPrice = bidPrice(levels.stopLoss, spreadBps, slippageBps);
  const hypotheticalTargetExecutionPrice = bidPrice(levels.takeProfit1, spreadBps, slippageBps);

  const entryFeePerUnitHyp = entryExecutionPrice.times(feeRate);
  const entryCashOutPerUnitHyp = entryExecutionPrice.plus(entryFeePerUnitHyp);
  const stopExitFeePerUnitHyp = hypotheticalStopExecutionPrice.times(feeRate);
  const stopCashInPerUnitHyp = hypotheticalStopExecutionPrice.minus(stopExitFeePerUnitHyp);
  const targetExitFeePerUnitHyp = hypotheticalTargetExecutionPrice.times(feeRate);
  const targetCashInPerUnitHyp = hypotheticalTargetExecutionPrice.minus(targetExitFeePerUnitHyp);

  const netRiskPerUnitHyp = entryCashOutPerUnitHyp.minus(stopCashInPerUnitHyp);
  const netRewardPerUnitHyp = targetCashInPerUnitHyp.minus(entryCashOutPerUnitHyp);

  if (!netRiskPerUnitHyp.greaterThan(0)) return { ok: false, reason: "NON_POSITIVE_NET_RISK" };
  if (!netRewardPerUnitHyp.greaterThan(0)) return { ok: false, reason: "NON_POSITIVE_NET_REWARD" };

  const netRiskReward = netRewardPerUnitHyp.dividedBy(netRiskPerUnitHyp).toNumber();
  if (netRiskReward < MIN_RR) return { ok: false, reason: "REALIZED_RR_BELOW_MINIMUM" };

  const entryTimeEquity = availableCash;
  const riskBudget = D8(entryTimeEquity.times(RISK_PER_TRADE_FRACTION));
  const riskSizedQuantity = Q8(riskBudget.dividedBy(netRiskPerUnitHyp));
  const cashAffordableQuantity = Q8(availableCash.dividedBy(entryExecutionPrice.times(feeRate.plus(1))));
  const initialQuantity = Prisma.Decimal.min(riskSizedQuantity, cashAffordableQuantity);
  const cashCapped = cashAffordableQuantity.lessThan(riskSizedQuantity);

  const sizing = sizeWithinCashAndRisk(
    initialQuantity, entryExecutionPrice, feeRate, availableCash, riskBudget, hypotheticalStopExecutionPrice,
  );
  if (!sizing.ok) return { ok: false, reason: sizing.reason };

  return {
    ok: true,
    entryExecutionPrice,
    quantity: sizing.quantity,
    entryNotional: sizing.entryNotional,
    entryFee: sizing.entryFee,
    entryCost: sizing.entryCost,
    intendedRiskBudget: riskBudget,
    actualNetRisk: sizing.actualNetRisk!,
    actualRiskFraction: sizing.actualNetRisk!.dividedBy(entryTimeEquity).toNumber(),
    cashCapped,
    netRiskReward,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-entry-validation.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/fills.ts pixel-office/tests/backtest-entry-validation.test.ts
git commit -m "feat(backtest): add complete entry-validation sequence"
```

**Checkpoint-3-so-far report gate:** run
`cd pixel-office && npx vitest run tests/backtest-*.test.ts && npx tsc --noEmit` before
continuing to Task 13.

### Task 13: Per-bar event loop with sequence numbers, gap handling, and forced liquidation

**Files:**
- Create: `pixel-office/lib/backtest/simulate.ts`
- Test: `pixel-office/tests/backtest-simulate.test.ts`

**Interfaces:**
- Consumes: `type { Candle }` from `@/lib/market-data/candles`; `isDecisionBar`,
  `isTradableBar`, `EvaluationWindow` from `./candle-window` (Task 5);
  `validateAndSizeEntry`, `detectExitTrigger`, `gapExitRawMid`, `computeExit`,
  `EntrySignalLevels` from `./fills` (Tasks 9/12); `D8` from `./decimal` (Task 3);
  `TradeLedgerEntry`, `EquityPoint`, `UnexecutedSignalRecord`, `ExecutionEvent` from
  `./types` (Task 1).
- Produces: `SignalProviderResult` type, `SignalProvider` type (`(closedPrimaryCandles:
  Candle[], analysisNow: number) => SignalProviderResult`), `SimulateConfig` type,
  `SimulateResult` type (`{ tradeLedger, unexecutedSignals, equityCurve, events }`),
  `runSimulation(primaryCandles: Candle[], window: EvaluationWindow, primaryDurationMs:
  number, signalProvider: SignalProvider, config: SimulateConfig): SimulateResult` —
  consumed by `run-backtest.ts` (Task 16), tested here with a **fixture**
  `SignalProvider` so the loop's mechanics are proven before real-engine wiring
  (Checkpoint 4).

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-simulate.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { runSimulation, type SignalProviderResult } from "@/lib/backtest/simulate";
import type { EvaluationWindow } from "@/lib/backtest/candle-window";

const H4 = 14_400_000;
function bar(openTime: number, open: number, high: number, low: number, close: number): Candle {
  return { openTime, open, high, low, close, volume: 100 };
}

function windowFor(startBarIndexOpenTime: number, endBoundary: number): EvaluationWindow {
  return { normalizedStart: startBarIndexOpenTime, normalizedEnd: endBoundary, effectiveEndBoundary: endBoundary };
}

const WAIT: SignalProviderResult = { direction: "WAIT", entryZone: null, stopLoss: null, takeProfit1: null };

function baseConfig(overrides: Partial<import("@/lib/backtest/simulate").SimulateConfig> = {}) {
  return {
    spreadBps: 0,
    slippageBps: 0,
    feeRate: new Prisma.Decimal("0"),
    initialBalance: new Prisma.Decimal("10000"),
    finalize: true,
    ...overrides,
  };
}

describe("runSimulation — decision-bar/tradable-bar wiring (spec §6.3 worked example)", () => {
  // A: 04:00-08:00 (decision-only), B: 08:00-12:00 (both, first tradable),
  // C: 12:00-16:00 (tradable-only, final).
  const A = bar(1 * H4, 100, 101, 99, 100);
  const B = bar(2 * H4, 100, 106, 99, 105);
  const C = bar(3 * H4, 105, 106, 104, 105);
  const candles = [A, B, C];
  const window = windowFor(2 * H4, 4 * H4);

  it("never calls the signal provider for bar C (tradable-only, no new signal)", () => {
    const calls: number[] = [];
    runSimulation(candles, window, H4, (closed, now) => {
      calls.push(now);
      return WAIT;
    }, baseConfig());
    expect(calls).toEqual([2 * H4, 3 * H4]); // A's close and B's close only — never C's
  });

  it("the equity curve's first point is the synthetic baseline at normalizedStart, then one point per tradable bar", () => {
    const result = runSimulation(candles, window, H4, () => WAIT, baseConfig());
    expect(result.equityCurve.map((p) => p.time)).toEqual([2 * H4, 3 * H4, 4 * H4]);
  });
});

describe("runSimulation — entry only fills on the bar AFTER the signal, never the signal bar itself", () => {
  const A = bar(1 * H4, 100, 101, 99, 100);
  const B = bar(2 * H4, 100, 106, 99, 105); // entry bar: open=100
  const C = bar(3 * H4, 105, 120, 104, 118); // TP1 touched here
  const candles = [A, B, C];
  const window = windowFor(2 * H4, 4 * H4);
  const LONG: SignalProviderResult = {
    direction: "LONG",
    entryZone: { low: 99, high: 101 },
    stopLoss: 90,
    takeProfit1: 115,
  };

  it("fills at B.open (the bar after A's signal), never at A's own price levels", () => {
    const result = runSimulation(candles, window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig());
    expect(result.tradeLedger.length).toBe(1);
    expect(result.tradeLedger[0].entryTime).toBe(2 * H4); // B.openTime, not A's
    expect(result.tradeLedger[0].entryPrice).toBe("100"); // B.open, never any field of A
  });

  it("a position filled at the entry bar's open can still exit within that SAME bar via steps 2-3", () => {
    const gapUpBar = bar(2 * H4, 100, 116, 99, 105); // touches TP1 (115) intrabar, same bar as the fill
    const result = runSimulation([A, gapUpBar, C], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig());
    expect(result.tradeLedger.length).toBe(1);
    expect(result.tradeLedger[0].exitReason).toBe("TP1");
    expect(result.tradeLedger[0].exitTime).toBe(3 * H4); // gapUpBar's close
  });
});

describe("runSimulation — pending entry expiry", () => {
  const A = bar(1 * H4, 100, 101, 99, 100);
  const gap = bar(5 * H4, 100, 101, 99, 100); // non-contiguous next bar
  const window = windowFor(2 * H4, 8 * H4);
  const LONG: SignalProviderResult = { direction: "LONG", entryZone: { low: 99, high: 101 }, stopLoss: 90, takeProfit1: 115 };

  it("expires GAP_BEFORE_ENTRY when the next bar is non-contiguous, and never trades", () => {
    const result = runSimulation([A, gap], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig());
    expect(result.tradeLedger.length).toBe(0);
    expect(result.unexecutedSignals.some((u) => u.reason === "GAP_BEFORE_ENTRY")).toBe(true);
  });
});

describe("runSimulation — forced end-of-test liquidation and final-equity replacement", () => {
  const A = bar(1 * H4, 100, 101, 99, 100);
  const B = bar(2 * H4, 100, 106, 99, 105);
  const C = bar(3 * H4, 105, 106, 104, 105); // never touches stop or TP1
  const window = windowFor(2 * H4, 4 * H4);
  const LONG: SignalProviderResult = { direction: "LONG", entryZone: { low: 99, high: 101 }, stopLoss: 90, takeProfit1: 200 };

  it("finalize:true force-closes an open position at the final bar's close with exitReason END_OF_TEST", () => {
    const result = runSimulation([A, B, C], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig({ finalize: true }));
    expect(result.tradeLedger.length).toBe(1);
    expect(result.tradeLedger[0].exitReason).toBe("END_OF_TEST");
    expect(result.tradeLedger[0].exitTime).toBe(4 * H4);
  });

  it("finalize:false leaves the position open — no synthetic trade, equity curve unmarked by a forced exit", () => {
    const result = runSimulation([A, B, C], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig({ finalize: false }));
    expect(result.tradeLedger.length).toBe(0);
  });

  it("the final equity point is REPLACED (not duplicated) by the post-liquidation value", () => {
    const result = runSimulation([A, B, C], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig({ finalize: true }));
    const finalPoints = result.equityCurve.filter((p) => p.time === 4 * H4);
    expect(finalPoints.length).toBe(1);
  });
});

describe("runSimulation — sequence numbers order SIGNAL_COMPUTED before the following ENTRY_PROCESSED, even at equal timestamps", () => {
  const A = bar(1 * H4, 100, 101, 99, 100);
  const B = bar(2 * H4, 100, 101, 99, 100); // B.openTime === A.closeTime
  const window = windowFor(2 * H4, 6 * H4);
  const LONG: SignalProviderResult = { direction: "LONG", entryZone: { low: 99, high: 101 }, stopLoss: 90, takeProfit1: 115 };

  it("SIGNAL_COMPUTED for A has a lower sequenceNumber than ENTRY_PROCESSED for B", () => {
    const result = runSimulation([A, B], window, H4, (closed, now) => (now === 2 * H4 ? LONG : WAIT), baseConfig());
    const signalEvent = result.events.find((e) => e.type === "SIGNAL_COMPUTED" && e.time === 2 * H4)!;
    const entryEvent = result.events.find((e) => e.type === "ENTRY_PROCESSED" && e.time === 2 * H4)!;
    expect(signalEvent.sequenceNumber).toBeLessThan(entryEvent.sequenceNumber);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-simulate.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/simulate'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/simulate.ts
//
// The per-bar event loop (spec §7). Strict order: 1) pending entry at open, 2) gap
// exit for an ALREADY-open position, 3) intrabar stop/TP1, 4) equity mark, 5) signal
// (decision bars only), 6) queue next entry. A missing/delayed next bar expires the
// pending entry (GAP_BEFORE_ENTRY) — it is never deferred to a later, non-contiguous
// bar. Pure, deterministic, no I/O, no wall clock — `signalProvider` is injected so
// this loop's mechanics can be tested independently of the real signal engine
// (wired in Task 16).
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { isDecisionBar, isTradableBar, type EvaluationWindow } from "./candle-window";
import { validateAndSizeEntry, detectExitTrigger, gapExitRawMid, computeExit, type EntrySignalLevels } from "./fills";
import { D8 } from "./decimal";
import type { TradeLedgerEntry, EquityPoint, UnexecutedSignalRecord, ExecutionEvent, ExitReason } from "./types";

export interface SignalProviderResult {
  direction: "LONG" | "SHORT" | "WAIT";
  entryZone: { low: number; high: number } | null;
  stopLoss: number | null;
  takeProfit1: number | null;
}
export type SignalProvider = (closedPrimaryCandles: Candle[], analysisNow: number) => SignalProviderResult;

export interface SimulateConfig {
  spreadBps: number;
  slippageBps: number;
  feeRate: Prisma.Decimal;
  initialBalance: Prisma.Decimal;
  finalize: boolean;
}

export interface SimulateResult {
  tradeLedger: TradeLedgerEntry[];
  unexecutedSignals: UnexecutedSignalRecord[];
  equityCurve: EquityPoint[];
  events: ExecutionEvent[];
}

interface OpenPosition {
  entryTime: number;
  entryExecutionPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
  entryNotional: Prisma.Decimal;
  entryFee: Prisma.Decimal;
  entryCost: Prisma.Decimal;
  stopLoss: number;
  takeProfit1: number;
  intendedRiskBudget: Prisma.Decimal;
  actualNetRisk: Prisma.Decimal;
  actualRiskFraction: number;
  cashCapped: boolean;
  netRiskReward: number;
}

interface PendingEntry {
  fromBarIndex: number;
  levels: EntrySignalLevels;
}

export function runSimulation(
  primaryCandles: Candle[],
  window: EvaluationWindow,
  primaryDurationMs: number,
  signalProvider: SignalProvider,
  config: SimulateConfig,
): SimulateResult {
  let seq = 0;
  const events: ExecutionEvent[] = [];
  const emit = (type: ExecutionEvent["type"], time: number) => {
    events.push({ type, time, sequenceNumber: seq++ });
  };

  const tradeLedger: TradeLedgerEntry[] = [];
  const unexecutedSignals: UnexecutedSignalRecord[] = [];
  const equityCurve: EquityPoint[] = [{ time: window.normalizedStart, equity: config.initialBalance.toString() }];

  let cash = config.initialBalance;
  let openPosition: OpenPosition | null = null;
  let pendingEntry: PendingEntry | null = null;

  function closePosition(reason: ExitReason, rawMid: number, exitTime: number, extraWarning?: string) {
    if (!openPosition) return;
    const { exitExecutionPrice, exitNotional, exitFee, exitProceeds, realizedPnl } = computeExit(
      rawMid, config.spreadBps, config.slippageBps, config.feeRate, openPosition.quantity, openPosition.entryCost,
    );
    cash = D8(cash.plus(exitProceeds));
    tradeLedger.push({
      entryTime: openPosition.entryTime,
      entryPrice: openPosition.entryExecutionPrice.toString(),
      quantity: openPosition.quantity.toString(),
      entryNotional: openPosition.entryNotional.toString(),
      entryFee: openPosition.entryFee.toString(),
      entryCost: openPosition.entryCost.toString(),
      exitTime,
      exitPrice: exitExecutionPrice.toString(),
      exitReason: reason,
      exitNotional: exitNotional.toString(),
      exitFee: exitFee.toString(),
      exitProceeds: exitProceeds.toString(),
      realizedPnl: realizedPnl.toString(),
      intendedRiskBudget: openPosition.intendedRiskBudget.toString(),
      actualNetRisk: openPosition.actualNetRisk.toString(),
      actualRiskFraction: openPosition.actualRiskFraction,
      cashCapped: openPosition.cashCapped,
      netRiskReward: openPosition.netRiskReward,
      warnings: extraWarning ? [extraWarning] : [],
    });
    if (reason === "END_OF_TEST") {
      // Replace, not duplicate, the final equity-curve point (spec §10.7).
      equityCurve[equityCurve.length - 1] = { time: exitTime, equity: cash.toString() };
    }
    openPosition = null;
  }

  for (let i = 0; i < primaryCandles.length; i++) {
    const bar = primaryCandles[i];
    const barCloseTime = bar.openTime + primaryDurationMs;
    const tradable = isTradableBar(bar.openTime, barCloseTime, window);
    const decision = isDecisionBar(barCloseTime, window);

    if (tradable) {
      // Step 1: process any pending entry at this bar's open.
      if (pendingEntry && pendingEntry.fromBarIndex === i - 1) {
        const prevBar = primaryCandles[i - 1];
        const contiguous = bar.openTime === prevBar.openTime + primaryDurationMs;
        const signalCloseTime = prevBar.openTime + primaryDurationMs;
        if (!contiguous) {
          unexecutedSignals.push({ barCloseTime: signalCloseTime, reason: "GAP_BEFORE_ENTRY" });
        } else {
          const result = validateAndSizeEntry(bar.open, pendingEntry.levels, config.spreadBps, config.slippageBps, config.feeRate, cash);
          emit("ENTRY_PROCESSED", bar.openTime);
          if (result.ok) {
            cash = D8(cash.minus(result.entryCost));
            openPosition = {
              entryTime: bar.openTime,
              entryExecutionPrice: result.entryExecutionPrice,
              quantity: result.quantity,
              entryNotional: result.entryNotional,
              entryFee: result.entryFee,
              entryCost: result.entryCost,
              stopLoss: pendingEntry.levels.stopLoss,
              takeProfit1: pendingEntry.levels.takeProfit1,
              intendedRiskBudget: result.intendedRiskBudget,
              actualNetRisk: result.actualNetRisk,
              actualRiskFraction: result.actualRiskFraction,
              cashCapped: result.cashCapped,
              netRiskReward: result.netRiskReward,
            };
          } else {
            unexecutedSignals.push({ barCloseTime: signalCloseTime, reason: result.reason });
          }
        }
      }
      // A pending entry is consumed (attempted or expired) exactly once, on the very
      // next bar — never deferred to a later bar (spec §7/§8.3 step 1).
      pendingEntry = null;

      // Step 2: gap exits for a position ALREADY open entering this bar — never for a
      // position this same bar's step 1 just opened (spec §10.5).
      const justOpenedThisBar = openPosition !== null && openPosition.entryTime === bar.openTime;
      if (openPosition && !justOpenedThisBar) {
        const gap = gapExitRawMid(bar.open, openPosition.stopLoss, openPosition.takeProfit1);
        emit("GAP_EXIT_PROCESSED", bar.openTime);
        if (gap) closePosition(gap.trigger, gap.rawMid, bar.openTime, "GAP_RESOLVED_OPEN_POSITION");
      }

      // Step 3: intrabar stop/TP1 (applies whether pre-existing or just opened in step 1).
      if (openPosition) {
        const trigger = detectExitTrigger(bar.low, bar.high, openPosition.stopLoss, openPosition.takeProfit1);
        emit("INTRABAR_EXIT_PROCESSED", barCloseTime);
        if (trigger !== "NONE") {
          const rawMid = trigger === "STOP" ? openPosition.stopLoss : openPosition.takeProfit1;
          closePosition(trigger, rawMid, barCloseTime);
        }
      }

      // Step 4: mark equity at this bar's close.
      const equityValue = openPosition ? D8(cash.plus(openPosition.quantity.times(bar.close))) : cash;
      equityCurve.push({ time: barCloseTime, equity: equityValue.toString() });
      emit("EQUITY_MARKED", barCloseTime);
    }

    if (decision) {
      const closedSoFar = primaryCandles.slice(0, i + 1);
      const signal = signalProvider(closedSoFar, barCloseTime);
      emit("SIGNAL_COMPUTED", barCloseTime);
      if (
        signal.direction === "LONG" &&
        !openPosition &&
        signal.entryZone !== null &&
        signal.stopLoss !== null &&
        signal.takeProfit1 !== null
      ) {
        pendingEntry = {
          fromBarIndex: i,
          levels: {
            entryZoneLow: signal.entryZone.low,
            entryZoneHigh: signal.entryZone.high,
            stopLoss: signal.stopLoss,
            takeProfit1: signal.takeProfit1,
          },
        };
      }
    }
  }

  if (config.finalize && openPosition) {
    const finalBar = primaryCandles[primaryCandles.length - 1];
    closePosition("END_OF_TEST", finalBar.close, finalBar.openTime + primaryDurationMs, "Synthetic end-of-test liquidation — not a real market exit.");
  }

  return { tradeLedger, unexecutedSignals, equityCurve, events };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-simulate.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/simulate.ts pixel-office/tests/backtest-simulate.test.ts
git commit -m "feat(backtest): add per-bar event loop with sequence numbers and forced liquidation"
```

---

### Task 14: Buy-and-hold benchmark

**Files:**
- Create: `pixel-office/lib/backtest/benchmark.ts`
- Test: `pixel-office/tests/backtest-benchmark.test.ts`

**Interfaces:**
- Consumes: `askPrice`, `bidPrice`, `computeExit` from `./fills` (Task 9);
  `sizeWithinCashAndRisk` from `./sizing` (Task 10); `computeMetrics` from `./metrics`
  (Task 15 — this task is written and tested after Task 15 lands, see ordering note
  below); `D8` from `./decimal` (Task 3).
- Produces: `runBenchmark(tradableCandles: Candle[], spreadBps: number, slippageBps:
  number, feeRate: Prisma.Decimal, initialBalance: Prisma.Decimal, primaryDurationMs:
  number): BenchmarkResult` — consumed by `run-backtest.ts` (Task 16).

**Ordering note:** `runBenchmark` calls `computeMetrics` (Task 15) to fill in its
`.metrics` field. Implement Task 15 (`metrics.ts`) immediately before this task's Step 3
— the test below is still written first per TDD, it will simply fail on "cannot find
module `./metrics`" until Task 15's file exists; that is an acceptable, expected
intermediate failure state precisely because Task 15 is next.

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-benchmark.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { runBenchmark } from "@/lib/backtest/benchmark";

const H4 = 14_400_000;
function bar(openTime: number, open: number, high: number, low: number, close: number): Candle {
  return { openTime, open, high, low, close, volume: 100 };
}

describe("runBenchmark", () => {
  const B = bar(2 * H4, 100, 106, 99, 105); // first tradable bar
  const C = bar(3 * H4, 105, 108, 104, 107); // final tradable bar
  const tradable = [B, C];

  it("enters at the first tradable bar's open and exits at the final tradable bar's close", () => {
    const result = runBenchmark(tradable, 0, 0, new Prisma.Decimal("0"), new Prisma.Decimal("10000"), H4);
    expect(result.entryTime).toBe(2 * H4);
    expect(result.entryPrice).toBe("100.00000000");
    expect(result.exitTime).toBe(4 * H4);
    expect(result.exitPrice).toBe("107.00000000");
  });

  it("never spends more than the initial balance", () => {
    const result = runBenchmark(tradable, 5, 5, new Prisma.Decimal("0.001"), new Prisma.Decimal("10000"), H4);
    const entryCost = new Prisma.Decimal(result.quantity).times(result.entryPrice).times(1.001);
    expect(entryCost.lessThanOrEqualTo("10000")).toBe(true);
  });

  it("the equity curve's final point is replaced by the post-liquidation cash, one point per bar", () => {
    const result = runBenchmark(tradable, 0, 0, new Prisma.Decimal("0"), new Prisma.Decimal("10000"), H4);
    expect(result.equityCurve.length).toBe(2); // one per tradable bar, no duplicate final point
    expect(result.equityCurve[1].equity).toBe(result.finalCash);
  });

  it("applies identical fee/spread/slippage cost assumptions as the strategy path", () => {
    const zeroCost = runBenchmark(tradable, 0, 0, new Prisma.Decimal("0"), new Prisma.Decimal("10000"), H4);
    const withCost = runBenchmark(tradable, 5, 5, new Prisma.Decimal("0.001"), new Prisma.Decimal("10000"), H4);
    expect(new Prisma.Decimal(withCost.finalCash).lessThan(zeroCost.finalCash)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-benchmark.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/benchmark'` (and, until Task 15
lands, a second-order failure on `./metrics` inside that file once created — expected,
per the ordering note above).

- [ ] **Step 3: Write the implementation** (after Task 15's `metrics.ts` exists)

```ts
// pixel-office/lib/backtest/benchmark.ts
//
// Buy-and-hold benchmark (spec §10.8) — identical cost model and evaluation
// boundaries as the strategy: enters at the first tradable bar's open, exits at the
// final tradable bar's close, forced-liquidated the same way as an END_OF_TEST
// strategy position.
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { D8 } from "./decimal";
import { askPrice, computeExit } from "./fills";
import { sizeWithinCashAndRisk } from "./sizing";
import { computeMetrics } from "./metrics";
import type { BenchmarkResult, EquityPoint, TradeLedgerEntry } from "./types";

export function runBenchmark(
  tradableCandles: Candle[],
  spreadBps: number,
  slippageBps: number,
  feeRate: Prisma.Decimal,
  initialBalance: Prisma.Decimal,
  primaryDurationMs: number,
): BenchmarkResult {
  const firstBar = tradableCandles[0];
  const finalBar = tradableCandles[tradableCandles.length - 1];

  const entryExecutionPrice = askPrice(firstBar.open, spreadBps, slippageBps);
  const initialQuantity = initialBalance
    .dividedBy(entryExecutionPrice.times(feeRate.plus(1)))
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);

  const sizing = sizeWithinCashAndRisk(initialQuantity, entryExecutionPrice, feeRate, initialBalance, null, null);
  if (!sizing.ok) {
    // Structurally unreachable at the configured $100 minimum balance bound — defensive.
    throw new Error(`Benchmark sizing failed unexpectedly: ${sizing.reason}`);
  }
  const quantity = sizing.quantity;
  const residualCash = D8(initialBalance.minus(sizing.entryCost));

  const equityCurve: EquityPoint[] = tradableCandles.map((bar) => ({
    time: bar.openTime + primaryDurationMs,
    equity: D8(residualCash.plus(quantity.times(bar.close))).toString(),
  }));

  const { exitExecutionPrice, exitNotional, exitFee, exitProceeds, realizedPnl } = computeExit(
    finalBar.close, spreadBps, slippageBps, feeRate, quantity, sizing.entryCost,
  );
  const finalCash = D8(residualCash.plus(exitProceeds));
  equityCurve[equityCurve.length - 1] = { time: finalBar.openTime + primaryDurationMs, equity: finalCash.toString() };

  const trade: TradeLedgerEntry = {
    entryTime: firstBar.openTime,
    entryPrice: entryExecutionPrice.toString(),
    quantity: quantity.toString(),
    entryNotional: sizing.entryNotional.toString(),
    entryFee: sizing.entryFee.toString(),
    entryCost: sizing.entryCost.toString(),
    exitTime: finalBar.openTime + primaryDurationMs,
    exitPrice: exitExecutionPrice.toString(),
    exitReason: "END_OF_TEST",
    exitNotional: exitNotional.toString(),
    exitFee: exitFee.toString(),
    exitProceeds: exitProceeds.toString(),
    realizedPnl: realizedPnl.toString(),
    intendedRiskBudget: "0",
    actualNetRisk: "0",
    actualRiskFraction: 0,
    cashCapped: false,
    netRiskReward: 0,
    warnings: ["Synthetic end-of-test liquidation — not a real market exit."],
  };

  return {
    entryTime: trade.entryTime,
    entryPrice: trade.entryPrice,
    quantity: trade.quantity,
    exitTime: trade.exitTime,
    exitPrice: trade.exitPrice,
    finalCash: finalCash.toString(),
    metrics: computeMetrics(equityCurve, [trade], initialBalance),
    equityCurve,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-benchmark.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/benchmark.ts pixel-office/tests/backtest-benchmark.test.ts
git commit -m "feat(backtest): add buy-and-hold benchmark with identical cost model"
```

---

### Task 15: Pure metrics functions

**Files:**
- Create: `pixel-office/lib/backtest/metrics.ts`
- Test: `pixel-office/tests/backtest-metrics.test.ts`

**Interfaces:**
- Consumes: `D8` from `./decimal` (Task 3); `EquityPoint`, `TradeLedgerEntry`,
  `BacktestMetrics` from `./types` (Task 1).
- Produces: `computeMetrics(equityCurve: EquityPoint[], trades: TradeLedgerEntry[],
  initialBalance: Prisma.Decimal): BacktestMetrics` — consumed by `benchmark.ts` (Task
  14, already using it) and `run-backtest.ts` (Task 16). Callable on any prefix of an
  equity curve/trade ledger (used by the future-independence tests, Task 17).

**Implementation order note:** write and land this task's `metrics.ts` before Task 14's
Step 3, per Task 14's ordering note.

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-metrics.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { computeMetrics } from "@/lib/backtest/metrics";
import type { EquityPoint, TradeLedgerEntry } from "@/lib/backtest/types";

function trade(pnl: string): TradeLedgerEntry {
  return {
    entryTime: 0, entryPrice: "100", quantity: "1", entryNotional: "100", entryFee: "0",
    entryCost: "100", exitTime: 1, exitPrice: "100", exitReason: "STOP", exitNotional: "100",
    exitFee: "0", exitProceeds: "100", realizedPnl: pnl, intendedRiskBudget: "0",
    actualNetRisk: "0", actualRiskFraction: 0, cashCapped: false, netRiskReward: 0, warnings: [],
  };
}
function point(time: number, equity: string): EquityPoint {
  return { time, equity };
}

const initialBalance = new Prisma.Decimal("10000");

describe("computeMetrics — net profit and total return", () => {
  it("computes net profit as final equity minus initial balance", () => {
    const curve = [point(0, "10000"), point(1, "11000")];
    const m = computeMetrics(curve, [], initialBalance);
    expect(m.netProfit).toBe("1000.00000000");
    expect(m.totalReturn).toBeCloseTo(0.1);
  });
});

describe("computeMetrics — win rate, loss rate, breakeven treatment", () => {
  it("a breakeven trade counts in the denominator of both rates but neither numerator", () => {
    const trades = [trade("100"), trade("-50"), trade("0")];
    const m = computeMetrics([point(0, "10000")], trades, initialBalance);
    expect(m.tradeCount).toBe(3);
    expect(m.winRate).toBeCloseTo(1 / 3);
    expect(m.lossRate).toBeCloseTo(1 / 3);
  });
});

describe("computeMetrics — profit factor", () => {
  it("computes grossProfit/grossLoss when both exist", () => {
    const trades = [trade("100"), trade("-50")];
    const m = computeMetrics([point(0, "10000")], trades, initialBalance);
    expect(m.profitFactor).toBeCloseTo(2);
    expect(m.profitFactorReason).toBeNull();
  });

  it("is null with an explanatory reason when there are zero losing trades", () => {
    const trades = [trade("100"), trade("50")];
    const m = computeMetrics([point(0, "10000")], trades, initialBalance);
    expect(m.profitFactor).toBeNull();
    expect(m.profitFactorReason).toBe("undefined — no losing trades in this run");
  });
});

describe("computeMetrics — average win/loss sign convention", () => {
  it("reports average loss as a POSITIVE magnitude", () => {
    const trades = [trade("-50"), trade("-150")];
    const m = computeMetrics([point(0, "10000")], trades, initialBalance);
    expect(m.averageLoss).toBe("100.00000000"); // (50+150)/2, positive
  });
});

describe("computeMetrics — max drawdown (close-to-close, not intrabar)", () => {
  it("computes the largest peak-to-trough percentage decline", () => {
    const curve = [point(0, "10000"), point(1, "12000"), point(2, "9000"), point(3, "11000")];
    const m = computeMetrics(curve, [], initialBalance);
    expect(m.maxDrawdownPct).toBeCloseTo((12000 - 9000) / 12000);
  });
});

describe("computeMetrics — Sharpe: null on too few points or zero variance", () => {
  it("is null with fewer than two returns", () => {
    const m = computeMetrics([point(0, "10000")], [], initialBalance);
    expect(m.sharpe).toBeNull();
  });

  it("is null when every return is identical (zero variance)", () => {
    const curve = [point(0, "10000"), point(1, "10100"), point(2, "10201")]; // constant 1% growth
    const m = computeMetrics(curve, [], initialBalance);
    expect(m.sharpe).toBeNull();
  });

  it("is a finite positive number for a rising, variable equity curve", () => {
    const curve = [point(0, "10000"), point(1, "10300"), point(2, "10200"), point(3, "10600")];
    const m = computeMetrics(curve, [], initialBalance);
    expect(m.sharpe).not.toBeNull();
    expect(Number.isFinite(m.sharpe)).toBe(true);
  });
});

describe("computeMetrics — expectancy", () => {
  it("computes winRate*avgWin - lossRate*avgLoss", () => {
    const trades = [trade("100"), trade("-50")];
    const m = computeMetrics([point(0, "10000")], trades, initialBalance);
    // winRate=0.5, avgWin=100, lossRate=0.5, avgLoss=50 -> 0.5*100 - 0.5*50 = 25
    expect(m.expectancy).toBe("25.00000000");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-metrics.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/metrics'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/metrics.ts
//
// Pure metric functions (spec §11). Callable on any equity-curve/trade-ledger prefix
// (used by the future-independence tests, Task 17). Statistical math uses plain
// `number` (not Decimal) per spec §8.1 — rounding happens only at serialization.
import { Prisma } from "@prisma/client";
import { D8 } from "./decimal";
import type { BacktestMetrics, EquityPoint, TradeLedgerEntry } from "./types";

const ANNUALIZATION_FACTOR = Math.sqrt(365.25 * 6); // 4h bars/year

export function computeMetrics(
  equityCurve: EquityPoint[],
  trades: TradeLedgerEntry[],
  initialBalance: Prisma.Decimal,
): BacktestMetrics {
  const finalEquity = new Prisma.Decimal(equityCurve[equityCurve.length - 1]?.equity ?? initialBalance.toString());
  const netProfit = D8(finalEquity.minus(initialBalance));
  const totalReturn = netProfit.dividedBy(initialBalance).toNumber();

  const pnls = trades.map((t) => new Prisma.Decimal(t.realizedPnl));
  const wins = pnls.filter((p) => p.greaterThan(0));
  const losses = pnls.filter((p) => p.lessThan(0));
  const total = trades.length;
  const winRate = total > 0 ? wins.length / total : 0;
  const lossRate = total > 0 ? losses.length / total : 0;

  const grossProfit = wins.reduce((a, b) => a.plus(b), new Prisma.Decimal(0));
  const grossLoss = losses.reduce((a, b) => a.plus(b.abs()), new Prisma.Decimal(0)); // positive magnitude
  const profitFactor = grossLoss.isZero() ? null : grossProfit.dividedBy(grossLoss).toNumber();
  const profitFactorReason = grossLoss.isZero() ? "undefined — no losing trades in this run" : null;

  const averageWin = wins.length > 0 ? D8(grossProfit.dividedBy(wins.length)) : new Prisma.Decimal(0);
  const averageLoss = losses.length > 0 ? D8(grossLoss.dividedBy(losses.length)) : new Prisma.Decimal(0);

  const expectancy = D8(
    new Prisma.Decimal(winRate).times(averageWin).minus(new Prisma.Decimal(lossRate).times(averageLoss)),
  );

  let peak = new Prisma.Decimal(equityCurve[0]?.equity ?? initialBalance.toString());
  let maxDrawdownPct = 0;
  for (const p of equityCurve) {
    const value = new Prisma.Decimal(p.equity);
    if (value.greaterThan(peak)) peak = value;
    if (peak.greaterThan(0)) {
      const drawdown = peak.minus(value).dividedBy(peak).toNumber();
      if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
    }
  }

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = new Prisma.Decimal(equityCurve[i - 1].equity);
    const curr = new Prisma.Decimal(equityCurve[i].equity);
    if (prev.isZero()) continue;
    returns.push(curr.dividedBy(prev).minus(1).toNumber());
  }
  let sharpe: number | null = null;
  if (returns.length >= 2) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const stdev = Math.sqrt(variance);
    if (stdev > 0) sharpe = (mean / stdev) * ANNUALIZATION_FACTOR;
  }

  return {
    netProfit: netProfit.toString(),
    totalReturn,
    winRate,
    lossRate,
    profitFactor,
    profitFactorReason,
    maxDrawdownPct,
    sharpe,
    tradeCount: total,
    averageWin: averageWin.toString(),
    averageLoss: averageLoss.toString(),
    expectancy: expectancy.toString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-metrics.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/metrics.ts pixel-office/tests/backtest-metrics.test.ts
git commit -m "feat(backtest): add pure metrics functions"
```

Now go back and complete Task 14's Step 3 (`benchmark.ts`), which depends on this
task's `computeMetrics` — run its test file again to confirm it now passes:

Run: `cd pixel-office && npx vitest run tests/backtest-benchmark.test.ts`
Expected: PASS (4 tests, now that `./metrics` exists).

**Checkpoint 3 report gate:** run
`cd pixel-office && npx vitest run tests/backtest-*.test.ts && npx tsc --noEmit` and
confirm all green. Report files/commits/test counts and reconfirm
`portfolio/ui.tsx` is untouched.

## Checkpoint 4 — Signal-Engine Integration and Look-Ahead Invariants

### Task 16: `runBacktest` orchestrator wiring the real signal engine

**Files:**
- Create: `pixel-office/lib/backtest/run-backtest.ts`
- Test: `pixel-office/tests/backtest-run-backtest.test.ts`

**Interfaces:**
- Consumes: `buildSignalFromCandles` from `@/lib/trading-signals/engine` (accepted,
  unmodified); `type { Candle }` from `@/lib/market-data/candles`; `runSimulation`,
  `SignalProvider` from `./simulate` (Task 13); `runBenchmark` from `./benchmark`
  (Task 14); `computeMetrics` from `./metrics` (Task 15); `EvaluationWindow`,
  `TIMEFRAME_DURATION_MS_4H` from `./candle-window` (Task 5); `validateCandles`,
  `checkCoverage` from `./validate-candles` (Task 4); `D8` from `./decimal` (Task 3).
- Produces: `runBacktest(primaryCandles: Candle[], oneHourCandles: Candle[],
  oneDayCandles: Candle[], window: EvaluationWindow, config: { spreadBps: number;
  slippageBps: number; feeRate: Prisma.Decimal; initialBalance: Prisma.Decimal;
  finalize: boolean }): { simulate: SimulateResult; benchmark: BenchmarkResult;
  metrics: BacktestMetrics; dataQuality: Omit<DataQualityReport, "malformedCount" |
  "coverageShortfall"> }` — consumed by the API route (Task 21). This is the seam the
  future-independence tests (Task 17) call directly with `finalize:false`.

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-run-backtest.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { runBacktest } from "@/lib/backtest/run-backtest";
import type { EvaluationWindow } from "@/lib/backtest/candle-window";

const H4 = 14_400_000;

// 70 contiguous 4h candles: 60 warm-up bars + 10 evaluation bars, mild uptrend so
// detectSetup() has a real chance of proposing a LONG at some point — deterministic,
// fixed OHLCV, no randomness.
function buildPrimarySeries(count: number, startOpenTime: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const openTime = startOpenTime + i * H4;
    const open = price;
    price = price + 0.5 + (i % 3 === 0 ? 1.5 : 0); // gentle, deterministic uptrend
    const close = price;
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    candles.push({ openTime, open, high, low, close, volume: 100 + i });
  }
  return candles;
}

function buildFlatConfirmation(count: number, startOpenTime: number, durationMs: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const openTime = startOpenTime + i * durationMs;
    candles.push({ openTime, open: 100, high: 101, low: 99, close: 100 + (i % 2), volume: 100 });
  }
  return candles;
}

const config = {
  spreadBps: 5,
  slippageBps: 5,
  feeRate: new Prisma.Decimal("0.001"),
  initialBalance: new Prisma.Decimal("10000"),
  finalize: true,
};

describe("runBacktest — assembles simulate + benchmark + metrics + dataQuality", () => {
  const warmupStart = 0;
  const normalizedStart = 60 * H4;
  const normalizedEnd = 70 * H4;
  const window: EvaluationWindow = { normalizedStart, normalizedEnd, effectiveEndBoundary: normalizedEnd };

  const primary = buildPrimarySeries(70, warmupStart);
  const oneHour = buildFlatConfirmation(200, warmupStart, 3_600_000);
  const oneDay = buildFlatConfirmation(60, warmupStart - 50 * 86_400_000, 86_400_000);

  it("returns a coherent bundle whose benchmark and simulate share the same evaluation range", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    expect(result.benchmark.entryTime).toBe(60 * H4); // firstExecutionBar.open
    expect(result.benchmark.exitTime).toBe(70 * H4); // finalTradableBar.close
    expect(result.simulate.equityCurve[0].time).toBe(60 * H4);
    expect(result.simulate.equityCurve[result.simulate.equityCurve.length - 1].time).toBe(70 * H4);
  });

  it("trims the primary series to exclude any bar opening at/after effectiveEndBoundary before simulating", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    const lastEventTime = Math.max(...result.simulate.events.map((e) => e.time));
    expect(lastEventTime).toBeLessThanOrEqual(70 * H4);
  });

  it("dataQuality reflects the validate-candles pass over the primary series", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    expect(result.dataQuality.gapCount).toBe(0); // fixture is fully contiguous
    expect(result.dataQuality.conflictingDuplicateCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-run-backtest.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/run-backtest'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/run-backtest.ts
//
// Orchestrator: wires the REAL, unmodified buildSignalFromCandles as the simulation
// loop's SignalProvider (spec §1.1's load-bearing reuse fact), trims the primary
// series to the tradable range, and assembles simulate + benchmark + metrics +
// data-quality into one bundle. Zero I/O — every candle array is a parameter. This is
// the seam the future-independence tests (Task 17) call directly.
import { Prisma } from "@prisma/client";
import { buildSignalFromCandles } from "@/lib/trading-signals/engine";
import type { Candle } from "@/lib/market-data/candles";
import { runSimulation, type SignalProvider, type SimulateResult } from "./simulate";
import { runBenchmark } from "./benchmark";
import { computeMetrics } from "./metrics";
import { validateCandles } from "./validate-candles";
import { TIMEFRAME_DURATION_MS_4H, isTradableBar, type EvaluationWindow } from "./candle-window";
import type { BacktestMetrics, BenchmarkResult, DataQualityReport } from "./types";

export interface RunBacktestConfig {
  spreadBps: number;
  slippageBps: number;
  feeRate: Prisma.Decimal;
  initialBalance: Prisma.Decimal;
  finalize: boolean;
}

export interface RunBacktestResult {
  simulate: SimulateResult;
  benchmark: BenchmarkResult;
  metrics: BacktestMetrics;
  dataQuality: Omit<DataQualityReport, "malformedCount" | "coverageShortfall">;
}

function makeSignalProvider(oneHourCandles: Candle[], oneDayCandles: Candle[]): SignalProvider {
  return (closedPrimaryCandles, analysisNow) => {
    const series = {
      symbol: "BACKTEST",
      timeframe: "4h" as const,
      candles: closedPrimaryCandles,
      source: "live" as const,
      fetchedAt: analysisNow,
    };
    const signal = buildSignalFromCandles(series, new Date(analysisNow).toISOString(), {
      oneHourCandles,
      oneDayCandles,
    });
    if (signal.direction !== "LONG" || !signal.entryZone || signal.stopLoss === null || signal.takeProfit.length === 0) {
      return { direction: "WAIT", entryZone: null, stopLoss: null, takeProfit1: null };
    }
    return {
      direction: "LONG",
      entryZone: signal.entryZone,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfit[0].price,
    };
  };
}

export function runBacktest(
  primaryCandles: Candle[],
  oneHourCandles: Candle[],
  oneDayCandles: Candle[],
  window: EvaluationWindow,
  config: RunBacktestConfig,
): RunBacktestResult {
  const { candles: validatedPrimary, report: dataQuality } = validateCandles(primaryCandles, TIMEFRAME_DURATION_MS_4H);

  // Trim to bars opening strictly before effectiveEndBoundary — the tradable-bar open
  // criterion (spec §6.3) — so `primaryCandles[primaryCandles.length-1]` inside
  // runSimulation is guaranteed to be finalTradableBar.
  const trimmedPrimary = validatedPrimary.filter((c) => c.openTime < window.effectiveEndBoundary);

  const signalProvider = makeSignalProvider(oneHourCandles, oneDayCandles);
  const simulate = runSimulation(trimmedPrimary, window, TIMEFRAME_DURATION_MS_4H, signalProvider, config);

  // Reuse isTradableBar directly (rather than re-deriving its two conditions here) so
  // the benchmark's bar set can never drift from the strategy loop's own definition.
  const tradableCandles = trimmedPrimary.filter((c) =>
    isTradableBar(c.openTime, c.openTime + TIMEFRAME_DURATION_MS_4H, window),
  );
  const benchmark = runBenchmark(
    tradableCandles, config.spreadBps, config.slippageBps, config.feeRate, config.initialBalance, TIMEFRAME_DURATION_MS_4H,
  );

  const metrics = computeMetrics(simulate.equityCurve, simulate.tradeLedger, config.initialBalance);

  return { simulate, benchmark, metrics, dataQuality };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-run-backtest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/run-backtest.ts pixel-office/tests/backtest-run-backtest.test.ts
git commit -m "feat(backtest): wire the real signal engine into the backtest orchestrator"
```

---

### Task 17: Future-independence invariant suite (primary, 1h, 1d — independently)

**Files:**
- Create: `pixel-office/tests/backtest-future-independence.test.ts`

**Interfaces:**
- Consumes: `runBacktest` (Task 16) with `finalize: false`.

This is the single most important test in Phase 3 (spec §15) — it must be treated as
an un-skippable gate, not weakened to force a pass.

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-future-independence.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { runBacktest } from "@/lib/backtest/run-backtest";
import type { EvaluationWindow } from "@/lib/backtest/candle-window";

const H4 = 14_400_000;
const H1 = 3_600_000;
const D1 = 86_400_000;

function buildSeries(count: number, startOpenTime: number, durationMs: number, seed = 100): Candle[] {
  const candles: Candle[] = [];
  let price = seed;
  for (let i = 0; i < count; i++) {
    const openTime = startOpenTime + i * durationMs;
    const open = price;
    price = price + 0.5 + (i % 3 === 0 ? 1.5 : 0);
    const close = price;
    candles.push({ openTime, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume: 100 + i });
  }
  return candles;
}

// Perturbs every candle strictly after cutoffIndex (exclusive) to a wildly different,
// but still structurally valid, price path — proves nothing about the shape of the
// perturbation matters, only that it happens strictly after the cutoff.
function perturbAfter(series: Candle[], cutoffIndex: number): Candle[] {
  return series.map((c, i) => {
    if (i <= cutoffIndex) return c;
    const flipped = 100000 - c.close; // deliberately extreme, unrelated price level
    return { ...c, open: flipped, high: flipped + 5, low: flipped - 5, close: flipped };
  });
}

const config = {
  spreadBps: 5,
  slippageBps: 5,
  feeRate: new Prisma.Decimal("0.001"),
  initialBalance: new Prisma.Decimal("10000"),
  finalize: false, // spec §15 — no synthetic end-of-test exit in either run being compared
};

const warmupStart = 0;
const normalizedStart = 60 * H4;
const normalizedEnd = 90 * H4; // 30 evaluation bars, cutoff will sit inside this range
const window: EvaluationWindow = { normalizedStart, normalizedEnd, effectiveEndBoundary: normalizedEnd };
const cutoffTime = 75 * H4; // T — comfortably inside the evaluation range

function runAt(primary: Candle[], oneHour: Candle[], oneDay: Candle[]) {
  return runBacktest(primary, oneHour, oneDay, window, config);
}

describe("future-independence — perturbing PRIMARY candles strictly after T never changes decisions at/before T", () => {
  const basePrimary = buildSeries(90, warmupStart, H4);
  const oneHour = buildSeries(2200, warmupStart - 50 * H1, H1, 50);
  const oneDay = buildSeries(140, warmupStart - 50 * D1, D1, 200);
  const cutoffIndex = basePrimary.findIndex((c) => c.openTime + H4 === cutoffTime);

  const baseline = runAt(basePrimary, oneHour, oneDay);
  const perturbed = runAt(perturbAfter(basePrimary, cutoffIndex), oneHour, oneDay);

  it("every event at or before T is byte-identical between the two runs", () => {
    const baselineUpToT = baseline.simulate.events.filter((e) => e.time <= cutoffTime);
    const perturbedUpToT = perturbed.simulate.events.filter((e) => e.time <= cutoffTime);
    expect(perturbedUpToT).toEqual(baselineUpToT);
  });

  it("every trade ledger entry entered at or before T is byte-identical", () => {
    const baselineTrades = baseline.simulate.tradeLedger.filter((t) => t.entryTime <= cutoffTime);
    const perturbedTrades = perturbed.simulate.tradeLedger.filter((t) => t.entryTime <= cutoffTime);
    expect(perturbedTrades).toEqual(baselineTrades);
  });

  it("every equity-curve point at or before T is byte-identical", () => {
    const baselinePoints = baseline.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    const perturbedPoints = perturbed.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    expect(perturbedPoints).toEqual(baselinePoints);
  });
});

describe("future-independence — perturbing 1H confirmation candles strictly after T never changes decisions at/before T", () => {
  const primary = buildSeries(90, warmupStart, H4);
  const baseOneHour = buildSeries(2200, warmupStart - 50 * H1, H1, 50);
  const oneDay = buildSeries(140, warmupStart - 50 * D1, D1, 200);
  const cutoffIndex = baseOneHour.findIndex((c) => c.openTime + H1 >= cutoffTime);

  const baseline = runAt(primary, baseOneHour, oneDay);
  const perturbed = runAt(primary, perturbAfter(baseOneHour, cutoffIndex), oneDay);

  it("every equity-curve point at or before T is byte-identical when only 1h data changes after T", () => {
    const baselinePoints = baseline.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    const perturbedPoints = perturbed.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    expect(perturbedPoints).toEqual(baselinePoints);
  });
});

describe("future-independence — perturbing 1D confirmation candles strictly after T never changes decisions at/before T", () => {
  const primary = buildSeries(90, warmupStart, H4);
  const oneHour = buildSeries(2200, warmupStart - 50 * H1, H1, 50);
  const baseOneDay = buildSeries(140, warmupStart - 50 * D1, D1, 200);
  const cutoffIndex = baseOneDay.findIndex((c) => c.openTime + D1 >= cutoffTime);

  const baseline = runAt(primary, oneHour, baseOneDay);
  const perturbed = runAt(primary, oneHour, perturbAfter(baseOneDay, cutoffIndex));

  it("every equity-curve point at or before T is byte-identical when only 1d data changes after T", () => {
    const baselinePoints = baseline.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    const perturbedPoints = perturbed.simulate.equityCurve.filter((p) => p.time <= cutoffTime);
    expect(perturbedPoints).toEqual(baselinePoints);
  });
});

describe("finalize is purely additive", () => {
  const primary = buildSeries(90, warmupStart, H4);
  const oneHour = buildSeries(2200, warmupStart - 50 * H1, H1, 50);
  const oneDay = buildSeries(140, warmupStart - 50 * D1, D1, 200);

  it("finalize:true output equals finalize:false output plus one END_OF_TEST entry, nothing else changed", () => {
    const withoutFinalize = runAt(primary, oneHour, oneDay);
    const withFinalize = runBacktest(primary, oneHour, oneDay, window, { ...config, finalize: true });

    const closedTradesWithout = withoutFinalize.simulate.tradeLedger;
    const closedTradesWith = withFinalize.simulate.tradeLedger.filter((t) => t.exitReason !== "END_OF_TEST");
    expect(closedTradesWith).toEqual(closedTradesWithout);
  });
});

describe("structural sequencing — no entry at or before its own signal's decision time", () => {
  it("every ENTRY_PROCESSED event's time is >= the most recent SIGNAL_COMPUTED event's time, with a strictly greater sequenceNumber when equal", () => {
    const primary = buildSeries(90, warmupStart, H4);
    const oneHour = buildSeries(2200, warmupStart - 50 * H1, H1, 50);
    const oneDay = buildSeries(140, warmupStart - 50 * D1, D1, 200);
    const result = runAt(primary, oneHour, oneDay);

    const signalEvents = result.simulate.events.filter((e) => e.type === "SIGNAL_COMPUTED");
    const entryEvents = result.simulate.events.filter((e) => e.type === "ENTRY_PROCESSED");
    for (const entry of entryEvents) {
      const priorSignal = [...signalEvents].reverse().find((s) => s.time <= entry.time);
      expect(priorSignal).toBeDefined();
      if (priorSignal!.time === entry.time) {
        expect(entry.sequenceNumber).toBeGreaterThan(priorSignal!.sequenceNumber);
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (or pass)**

Run: `cd pixel-office && npx vitest run tests/backtest-future-independence.test.ts`
Expected: these exercise already-implemented code (Tasks 5–16); they should PASS if
Checkpoints 1–4's implementation is correct. If ANY assertion fails, it points at a
real look-ahead-bias defect in `simulate.ts`, `candle-window.ts`, or
`run-backtest.ts` — fix the production code, never weaken these assertions.

- [ ] **Step 3: (only if needed) fix the defect the failure points at**

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-future-independence.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/tests/backtest-future-independence.test.ts
git commit -m "test(backtest): add future-independence invariant suite for primary/1h/1d"
```

---

### Task 18: End-to-end "final four hours" boundary regression

**Files:**
- Create: `pixel-office/tests/backtest-boundary-e2e.test.ts`

**Interfaces:**
- Consumes: `runBacktest` (Task 16).

Proves the specific defect corrected in the approved spec (§6.3) stays fixed: no run
silently loses its final tradable bar.

- [ ] **Step 1: Write the failing test**

```ts
// pixel-office/tests/backtest-boundary-e2e.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { runBacktest } from "@/lib/backtest/run-backtest";
import type { EvaluationWindow } from "@/lib/backtest/candle-window";

const H4 = 14_400_000;

function buildSeries(count: number, startOpenTime: number, durationMs: number, seed = 100): Candle[] {
  const candles: Candle[] = [];
  let price = seed;
  for (let i = 0; i < count; i++) {
    const openTime = startOpenTime + i * durationMs;
    const open = price;
    price += 0.5;
    const close = price;
    candles.push({ openTime, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume: 100 });
  }
  return candles;
}

describe("the final tradable bar is always present — the corrected §6.3 boundary model", () => {
  const normalizedStart = 60 * H4;
  const normalizedEnd = 65 * H4; // exactly 5 tradable bars: B,C,D,E,F
  const window: EvaluationWindow = { normalizedStart, normalizedEnd, effectiveEndBoundary: normalizedEnd };
  const primary = buildSeries(65, 0, H4);
  const oneHour = buildSeries(2000, 0 - 50 * 3_600_000, 3_600_000, 50);
  const oneDay = buildSeries(120, 0 - 50 * 86_400_000, 86_400_000, 200);

  const config = {
    spreadBps: 5, slippageBps: 5, feeRate: new Prisma.Decimal("0.001"),
    initialBalance: new Prisma.Decimal("10000"), finalize: true,
  };

  it("the equity curve's last point is exactly at effectiveEndBoundary, not four hours earlier", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    const last = result.simulate.equityCurve[result.simulate.equityCurve.length - 1];
    expect(last.time).toBe(normalizedEnd);
  });

  it("the benchmark's exit is also exactly at effectiveEndBoundary", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    expect(result.benchmark.exitTime).toBe(normalizedEnd);
  });

  it("no ENTRY_PROCESSED event ever occurs at or after effectiveEndBoundary", () => {
    const result = runBacktest(primary, oneHour, oneDay, window, config);
    const lateEntries = result.simulate.events.filter((e) => e.type === "ENTRY_PROCESSED" && e.time >= normalizedEnd);
    expect(lateEntries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes)**

Run: `cd pixel-office && npx vitest run tests/backtest-boundary-e2e.test.ts`
Expected: PASS if Task 5/13/16 correctly implement the corrected boundary model — this
is a regression guard, not new production code.

- [ ] **Step 3: (only if needed) fix `candle-window.ts` or `simulate.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pixel-office && npx vitest run tests/backtest-boundary-e2e.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/tests/backtest-boundary-e2e.test.ts
git commit -m "test(backtest): add end-to-end final-tradable-bar boundary regression"
```

**Checkpoint 4 report gate:** run
`cd pixel-office && npx vitest run tests/backtest-*.test.ts && npx tsc --noEmit` and
confirm all green, with special attention to Task 17's future-independence suite and
Task 18's boundary regression — both must be genuinely green, never skipped or
weakened. Report files/commits/test counts and reconfirm `portfolio/ui.tsx` untouched.

## Checkpoint 5 — API, UI, CSV, Safety Checks, Documentation, and Full Verification

### Task 19: Result assembly, chart-only downsampling, and the 2 MB response cap

**Files:**
- Create: `pixel-office/lib/backtest/serialize.ts`
- Test: `pixel-office/tests/backtest-serialize.test.ts`

**Interfaces:**
- Consumes: `BacktestResult`, `DataQualityReport`, `EquityPoint` from `./types` (Task
  1); `RunBacktestResult` from `./run-backtest` (Task 16).
- Produces: `assembleBacktestResult(input: AssembleInput): BacktestResult`,
  `serializeForResponse(result: BacktestResult): { ok: true; body: string } | { ok:
  false; reason: "RESPONSE_TOO_LARGE" }` — consumed by the API route (Task 21).

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/backtest-serialize.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { assembleBacktestResult, serializeForResponse } from "@/lib/backtest/serialize";
import type { BacktestResult, EquityPoint, TradeLedgerEntry } from "@/lib/backtest/types";
import type { RunBacktestResult } from "@/lib/backtest/run-backtest";

function makeRunResult(equityPointCount: number): RunBacktestResult {
  const equityCurve: EquityPoint[] = Array.from({ length: equityPointCount }, (_, i) => ({
    time: i, equity: (10000 + i).toString(),
  }));
  const trades: TradeLedgerEntry[] = [];
  return {
    simulate: { tradeLedger: trades, unexecutedSignals: [], equityCurve, events: [] },
    benchmark: {
      entryTime: 0, entryPrice: "100", quantity: "1", exitTime: 1, exitPrice: "110",
      finalCash: "10100",
      metrics: {
        netProfit: "100", totalReturn: 0.01, winRate: 0, lossRate: 0, profitFactor: null,
        profitFactorReason: "undefined — no losing trades in this run", maxDrawdownPct: 0,
        sharpe: null, tradeCount: 0, averageWin: "0", averageLoss: "0", expectancy: "0",
      },
      equityCurve,
    },
    metrics: {
      netProfit: "100", totalReturn: 0.01, winRate: 0, lossRate: 0, profitFactor: null,
      profitFactorReason: "undefined — no losing trades in this run", maxDrawdownPct: 0,
      sharpe: null, tradeCount: 0, averageWin: "0", averageLoss: "0", expectancy: "0",
    },
    dataQuality: { invalidOhlcCount: 0, exactDuplicateCount: 0, conflictingDuplicateCount: 0, reordered: false, reorderCount: 0, gapCount: 0, gaps: [] },
  };
}

function baseInput(equityPointCount: number) {
  return {
    engineVersion: "phase3-v1",
    symbol: "BTC/USDT",
    requestedRange: { start: 0, end: 100 },
    fetchedWarmupRange: { primary: { start: 0, end: 100 }, oneHour: { start: 0, end: 100 }, oneDay: { start: 0, end: 100 } },
    actualEvaluationRange: { start: 0, end: 100 },
    candleCounts: { primary: 100, oneHour: 100, oneDay: 100 },
    configEcho: { initialBalance: "10000", feeRate: "0.001", spreadBps: 5, slippageBps: 5, riskPerTradeFraction: "0.005" },
    dataQuality: { malformedCount: 0, invalidOhlcCount: 0, exactDuplicateCount: 0, conflictingDuplicateCount: 0, reordered: false, reorderCount: 0, gapCount: 0, gaps: [], coverageShortfall: null },
    runResult: makeRunResult(equityPointCount),
    extraWarnings: [],
  };
}

describe("assembleBacktestResult", () => {
  it("carries the full-resolution equity curve into .equityCurve unchanged", () => {
    const result = assembleBacktestResult(baseInput(10));
    expect(result.equityCurve.length).toBe(10);
  });

  it("downsamples .equityCurveChart to at most 500 points, always including first and last", () => {
    const result = assembleBacktestResult(baseInput(1200));
    expect(result.equityCurveChart.length).toBeLessThanOrEqual(500);
    expect(result.equityCurveChart[0]).toEqual({ time: 0, equity: "10000" });
    expect(result.equityCurveChart[result.equityCurveChart.length - 1]).toEqual({ time: 1199, equity: "11199" });
  });

  it("leaves .equityCurveChart identical to .equityCurve when already under the cap", () => {
    const result = assembleBacktestResult(baseInput(10));
    expect(result.equityCurveChart).toEqual(result.equityCurve);
  });
});

describe("serializeForResponse", () => {
  it("returns ok:true with a valid JSON body under the cap", () => {
    const result = assembleBacktestResult(baseInput(10));
    const serialized = serializeForResponse(result);
    expect(serialized.ok).toBe(true);
    if (serialized.ok) expect(() => JSON.parse(serialized.body)).not.toThrow();
  });

  it("returns RESPONSE_TOO_LARGE when the serialized byte length exceeds the cap", () => {
    const huge = assembleBacktestResult(baseInput(10));
    // Inflate a warnings array to blow past 2MB deterministically, without a huge fixture.
    huge.warnings = Array.from({ length: 200_000 }, () => "x".repeat(20));
    const serialized = serializeForResponse(huge);
    expect(serialized.ok).toBe(false);
    if (!serialized.ok) expect(serialized.reason).toBe("RESPONSE_TOO_LARGE");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/backtest-serialize.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/serialize'`.

- [ ] **Step 3: Write the implementation**

```ts
// pixel-office/lib/backtest/serialize.ts
//
// Assembles the final BacktestResult wire shape and enforces the self-imposed 2MB
// UTF-8 response cap (spec §12) — not a platform claim. Metrics and the full trade
// ledger always use full-resolution data; only .equityCurveChart is downsampled, and
// only for display — no metric is ever computed from the downsampled series.
import type { BacktestResult, DataQualityReport, EquityPoint } from "./types";
import type { RunBacktestResult } from "./run-backtest";

const EQUITY_CHART_MAX_POINTS = 500;
const RESPONSE_SIZE_CAP_BYTES = 2_097_152;

function downsampleEquityCurve(curve: EquityPoint[], maxPoints: number): EquityPoint[] {
  if (curve.length <= maxPoints) return curve;
  const stride = (curve.length - 1) / (maxPoints - 1);
  const out: EquityPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(curve.length - 1, Math.round(i * stride));
    out.push(curve[idx]);
  }
  return out;
}

export interface AssembleInput {
  engineVersion: string;
  symbol: string;
  requestedRange: { start: number; end: number };
  fetchedWarmupRange: BacktestResult["fetchedWarmupRange"];
  actualEvaluationRange: { start: number; end: number };
  candleCounts: BacktestResult["candleCounts"];
  configEcho: BacktestResult["config"];
  dataQuality: DataQualityReport;
  runResult: RunBacktestResult;
  extraWarnings: string[];
}

export function assembleBacktestResult(input: AssembleInput): BacktestResult {
  return {
    engineVersion: input.engineVersion,
    symbol: input.symbol,
    timeframe: "4h",
    dataSource: "MEXC public klines",
    requestedRange: input.requestedRange,
    fetchedWarmupRange: input.fetchedWarmupRange,
    actualEvaluationRange: input.actualEvaluationRange,
    candleCounts: input.candleCounts,
    config: input.configEcho,
    dataQuality: input.dataQuality,
    tradeLedger: input.runResult.simulate.tradeLedger,
    unexecutedSignals: input.runResult.simulate.unexecutedSignals,
    equityCurve: input.runResult.simulate.equityCurve,
    equityCurveChart: downsampleEquityCurve(input.runResult.simulate.equityCurve, EQUITY_CHART_MAX_POINTS),
    metrics: input.runResult.metrics,
    benchmark: input.runResult.benchmark,
    warnings: input.extraWarnings,
  };
}

export type SerializeResult = { ok: true; body: string } | { ok: false; reason: "RESPONSE_TOO_LARGE" };

export function serializeForResponse(result: BacktestResult): SerializeResult {
  const body = JSON.stringify(result);
  const byteLength = Buffer.byteLength(body, "utf8");
  if (byteLength > RESPONSE_SIZE_CAP_BYTES) {
    return { ok: false, reason: "RESPONSE_TOO_LARGE" };
  }
  return { ok: true, body };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/backtest-serialize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/backtest/serialize.ts pixel-office/tests/backtest-serialize.test.ts
git commit -m "feat(backtest): add result assembly, chart downsampling, and 2MB response cap"
```

---

### Task 20: Extend the static safety scan to cover `lib/backtest/`

**Files:**
- Modify: `pixel-office/tests/trading-signals-safety.test.ts`

**Interfaces:**
- Consumes: nothing new — extends the existing `tsFilesUnder`/`importSpecifiers`/
  `FORBIDDEN` helpers already in this file.

- [ ] **Step 1: Write the failing tests**

Add to `pixel-office/tests/trading-signals-safety.test.ts` (below the existing
`describe` block, same file):

```ts
describe("lib/backtest/ safety boundary (deterministic core)", () => {
  const backtestFiles = tsFilesUnder(join(ROOT, "lib", "backtest"));
  const EXTRA_FORBIDDEN = /@\/lib\/market-data\/historical-candles|@\/lib\/trading-bot\//;

  it("scans a non-empty set of backtest files", () => {
    expect(backtestFiles.length).toBeGreaterThan(0);
  });

  it("no backtest file imports the historical fetch module, trading-bot, or a forbidden execution capability", () => {
    const violations: string[] = [];
    for (const file of backtestFiles) {
      const src = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        if (FORBIDDEN.test(spec) || EXTRA_FORBIDDEN.test(spec)) {
          violations.push(`${file} -> "${spec}"`);
        }
      }
      if (/\bgetCandles\b/.test(src)) {
        violations.push(`${file} references getCandles (forbidden — live fetch, not for the deterministic core)`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("any import of lib/market-data/candles.ts from lib/backtest/ is type-only", () => {
    const violations: string[] = [];
    for (const file of backtestFiles) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        const mentionsCandles = line.includes('"@/lib/market-data/candles"') || line.includes("'@/lib/market-data/candles'");
        if (mentionsCandles && !/^\s*import\s+type\s/.test(line)) {
          violations.push(`${file}: "${line.trim()}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
```

Also widen the existing top-level `targets` array (in the original `describe` block)
to include `lib/backtest/` so the general FORBIDDEN-word scan applies there too:

```ts
const targets = [
  ...tsFilesUnder(join(ROOT, "lib", "trading-signals")),
  ...tsFilesUnder(join(ROOT, "lib", "backtest")),
  join(ROOT, "lib", "market-data", "candles.ts"),
  join(ROOT, "app", "api", "trading-signals", "route.ts"),
];
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/trading-signals-safety.test.ts`
Expected: at this point in the plan `lib/backtest/` already exists and is already
clean (Checkpoints 1–4 never violated the boundary), so this should PASS immediately —
this task adds a permanent regression gate, not a fix for an existing violation. If it
fails, a prior task introduced a forbidden import; fix that task's file, never this
test.

- [ ] **Step 3: (only if needed) fix the offending `lib/backtest/` file**

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/trading-signals-safety.test.ts`
Expected: PASS (5 tests — 2 original + 3 new).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/tests/trading-signals-safety.test.ts
git commit -m "test(backtest): extend the static safety scan to cover lib/backtest/"
```

---

### Task 21: Authenticated, rate-limited, strictly-whitelisted API route

**Files:**
- Modify: `pixel-office/lib/api/rate-limit.ts:86-92` (add a `"backtestRun"` bucket)
- Create: `pixel-office/app/api/trading-bot/backtest/route.ts`
- Modify: `pixel-office/vercel.json` (add the route's explicit `maxDuration`)
- Test: `pixel-office/tests/trading-bot-backtest-route.test.ts`

**Interfaces:**
- Consumes: `requireUser` (`@/lib/auth/current-user`), `enforceRateLimit`
  (`@/lib/api/rate-limit`), `toErrorResponse`/`BadRequest` (`@/lib/api/errors`),
  `raceWithDeadline` (`@/lib/api/deadline`, Task 8), `SYMBOL_WHITELIST`,
  `SUPPORTED_SYMBOLS` (`@/lib/trading-signals/config`), `fetchBacktestHistory` (Task
  7), `normalizeRange`, `TIMEFRAME_DURATION_MS_4H` (Task 5), `runBacktest` (Task 16),
  `validateCandles`, `checkCoverage` (Task 4), `assembleBacktestResult`,
  `serializeForResponse` (Task 19), `CONFIG_BOUNDS`, `MAX_REQUESTED_RANGE_DAYS` (Task
  2).
- Produces: `POST /api/trading-bot/backtest` — consumed by the UI (Task 22).

- [ ] **Step 1: Write the failing tests**

```ts
// pixel-office/tests/trading-bot-backtest-route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "user-1", clerkUserId: "clerk-1" }),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));

const H4 = 14_400_000;
function row(openTime: number): unknown[] {
  return [openTime, 100, 101, 99, 100, "10", openTime + H4, "1000"];
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as unknown as Response;
}

describe("POST /api/trading-bot/backtest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([row(0)])));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("rejects an unsupported symbol with 400, before any fetch is attempted", async () => {
    const { POST } = await import("@/app/api/trading-bot/backtest/route");
    const req = new Request("http://localhost/api/trading-bot/backtest", {
      method: "POST",
      body: JSON.stringify({ symbol: "DOGE/USDT", requestedStart: 0, requestedEnd: 10 * 86_400_000 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a range larger than MAX_REQUESTED_RANGE_DAYS with 400", async () => {
    const { POST } = await import("@/app/api/trading-bot/backtest/route");
    const req = new Request("http://localhost/api/trading-bot/backtest", {
      method: "POST",
      body: JSON.stringify({ symbol: "BTC/USDT", requestedStart: 0, requestedEnd: 400 * 86_400_000 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-bounds initialBalance with 400", async () => {
    const { POST } = await import("@/app/api/trading-bot/backtest/route");
    const req = new Request("http://localhost/api/trading-bot/backtest", {
      method: "POST",
      body: JSON.stringify({
        symbol: "BTC/USDT", requestedStart: 0, requestedEnd: 10 * 86_400_000, initialBalance: 50,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("never accepts a user-supplied provider URL field", async () => {
    const { POST } = await import("@/app/api/trading-bot/backtest/route");
    const req = new Request("http://localhost/api/trading-bot/backtest", {
      method: "POST",
      body: JSON.stringify({
        symbol: "BTC/USDT", requestedStart: 0, requestedEnd: 10 * 86_400_000,
        providerUrl: "https://evil.example.com",
      }),
    });
    const res = await POST(req);
    // The schema has no providerUrl field — zod strips/ignores it; the route must
    // never read an unvalidated field off the raw body for the fetch URL.
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(fetchCalls.every((u) => u.startsWith("https://api.mexc.com/"))).toBe(true);
    expect(res.status).not.toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pixel-office && npx vitest run tests/trading-bot-backtest-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/trading-bot/backtest/route'`.

- [ ] **Step 3a: Add the `backtestRun` rate-limit bucket**

Modify `pixel-office/lib/api/rate-limit.ts`:

```ts
// Change the RateLimitBucket union (around line 86-92):
export type RateLimitBucket =
  | "write"
  | "providerRead"
  | "agentsRead"
  | "signalsRead"
  | "tradingBotRead"
  | "tradingBotWrite"
  | "backtestRun";
```

```ts
// Add a branch in limiterFor's ternary chain (around line 112-123), inserted before
// the final `: envInt("RATE_LIMIT_READ_MAX", 60)` fallback:
              : bucket === "backtestRun"
                ? envInt("RATE_LIMIT_BACKTEST_MAX", 5)
```

- [ ] **Step 3b: Write the route**

```ts
// pixel-office/app/api/trading-bot/backtest/route.ts
export const runtime = "nodejs";
export const maxDuration = 60; // mirrors the explicit vercel.json override, Step 3c

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/current-user";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { toErrorResponse, BadRequest } from "@/lib/api/errors";
import { raceWithDeadline } from "@/lib/api/deadline";
import { SYMBOL_WHITELIST, SUPPORTED_SYMBOLS } from "@/lib/trading-signals/config";
import { fetchBacktestHistory } from "@/lib/market-data/historical-candles";
import { normalizeRange, TIMEFRAME_DURATION_MS_4H } from "@/lib/backtest/candle-window";
import { runBacktest } from "@/lib/backtest/run-backtest";
import { validateCandles, checkCoverage } from "@/lib/backtest/validate-candles";
import { assembleBacktestResult, serializeForResponse } from "@/lib/backtest/serialize";
import { CONFIG_BOUNDS, MAX_REQUESTED_RANGE_DAYS } from "@/lib/backtest/config";

const INTERNAL_DEADLINE_MS = 55_000;
const ONE_DAY_MS = 86_400_000;
const ONE_HOUR_MS = 3_600_000;

const requestSchema = z.object({
  symbol: z.enum(SUPPORTED_SYMBOLS as [string, ...string[]]),
  requestedStart: z.number().int(),
  requestedEnd: z.number().int(),
  initialBalance: z.number().min(CONFIG_BOUNDS.initialBalance.min).max(CONFIG_BOUNDS.initialBalance.max).default(10000),
  feeRate: z.number().min(CONFIG_BOUNDS.feeRate.min).max(CONFIG_BOUNDS.feeRate.max).default(0.001),
  spreadBps: z.number().min(CONFIG_BOUNDS.spreadBps.min).max(CONFIG_BOUNDS.spreadBps.max).default(5),
  slippageBps: z.number().min(CONFIG_BOUNDS.slippageBps.min).max(CONFIG_BOUNDS.slippageBps.max).default(5),
});

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "backtestRun");

    const body = await request.json();
    const input = requestSchema.parse(body);

    if (input.requestedEnd <= input.requestedStart) {
      throw new BadRequest("requestedEnd must be after requestedStart");
    }
    const rangeDays = (input.requestedEnd - input.requestedStart) / ONE_DAY_MS;
    if (rangeDays < 1 || rangeDays > MAX_REQUESTED_RANGE_DAYS) {
      throw new BadRequest(`Range must be between 1 and ${MAX_REQUESTED_RANGE_DAYS} days`);
    }

    // Symbol -> exchange ticker comes ONLY from the server-side whitelist map. No
    // request field is ever used to build the provider URL directly.
    const ticker = SYMBOL_WHITELIST[input.symbol];

    const controller = new AbortController();
    request.signal.addEventListener("abort", () => controller.abort());

    // latestFullyClosedBarBoundary MUST be 4h-grid-aligned — normalizeRange's
    // effectiveEndBoundary feeds isTradableBar's closeTime<=effectiveEndBoundary check
    // (candle-window.ts, Task 5), so an unaligned raw Date.now() here would silently
    // break the tradable-bar boundary math. Floor to the grid first.
    const latestFullyClosedBarBoundary = Math.floor(Date.now() / TIMEFRAME_DURATION_MS_4H) * TIMEFRAME_DURATION_MS_4H;
    const window = normalizeRange(input.requestedStart, input.requestedEnd, latestFullyClosedBarBoundary);

    const bundle = await raceWithDeadline(
      fetchBacktestHistory(ticker, window.normalizedStart, window.normalizedEnd, controller.signal),
      INTERNAL_DEADLINE_MS,
      () => {
        controller.abort();
        return null;
      },
    );
    if (bundle === null || bundle.primary.failed || bundle.oneHour.failed || bundle.oneDay.failed) {
      throw new BadRequest("Historical data fetch failed or timed out");
    }

    const { candles: validatedPrimary, report: primaryReport } = validateCandles(bundle.primary.candles, TIMEFRAME_DURATION_MS_4H);
    if (primaryReport.conflictingDuplicateCount > 0) {
      throw new BadRequest("Conflicting duplicate candles detected in primary data — refusing to run");
    }
    if (validatedPrimary.length < 60) {
      throw new BadRequest("Insufficient warm-up history for the requested range");
    }

    const primaryCoverage = checkCoverage(
      validatedPrimary,
      window.normalizedStart - 60 * TIMEFRAME_DURATION_MS_4H,
      window.normalizedEnd - 1,
      TIMEFRAME_DURATION_MS_4H,
    );

    const config = {
      spreadBps: input.spreadBps,
      slippageBps: input.slippageBps,
      feeRate: new Prisma.Decimal(input.feeRate),
      initialBalance: new Prisma.Decimal(input.initialBalance),
      finalize: true,
    };

    const runResult = runBacktest(validatedPrimary, bundle.oneHour.candles, bundle.oneDay.candles, window, config);

    const result = assembleBacktestResult({
      engineVersion: "phase3-v1",
      symbol: input.symbol,
      requestedRange: { start: input.requestedStart, end: input.requestedEnd },
      fetchedWarmupRange: {
        primary: { start: window.normalizedStart - 60 * TIMEFRAME_DURATION_MS_4H, end: window.normalizedEnd },
        oneHour: { start: window.normalizedStart - 50 * ONE_HOUR_MS, end: window.normalizedEnd },
        oneDay: { start: window.normalizedStart - 50 * ONE_DAY_MS, end: window.normalizedEnd },
      },
      actualEvaluationRange: { start: window.normalizedStart, end: window.effectiveEndBoundary },
      candleCounts: {
        primary: validatedPrimary.length,
        oneHour: bundle.oneHour.candles.length,
        oneDay: bundle.oneDay.candles.length,
      },
      configEcho: {
        initialBalance: config.initialBalance.toString(),
        feeRate: config.feeRate.toString(),
        spreadBps: config.spreadBps,
        slippageBps: config.slippageBps,
        riskPerTradeFraction: "0.005",
      },
      dataQuality: { malformedCount: bundle.primary.malformedCount, ...primaryReport, coverageShortfall: primaryCoverage },
      runResult,
      extraWarnings: bundle.primary.truncated
        ? ["Primary candle pagination truncated at the page cap — results may reflect a shorter-than-requested range."]
        : [],
    });

    const serialized = serializeForResponse(result);
    if (!serialized.ok) {
      return NextResponse.json({ error: "RESPONSE_TOO_LARGE" }, { status: 413 });
    }
    return new NextResponse(serialized.body, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 3c: Register the route's explicit runtime budget**

Modify `pixel-office/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "prisma generate && next build",
  "regions": ["iad1"],
  "functions": {
    "app/api/cron/snapshot/route.ts": { "maxDuration": 60 },
    "app/api/trading-bot/backtest/route.ts": { "maxDuration": 60 }
  },
  "crons": [
    { "path": "/api/cron/snapshot", "schedule": "0 22 * * *" }
  ]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pixel-office && npx vitest run tests/trading-bot-backtest-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/lib/api/rate-limit.ts pixel-office/app/api/trading-bot/backtest/route.ts pixel-office/vercel.json pixel-office/tests/trading-bot-backtest-route.test.ts
git commit -m "feat(backtest): add authenticated, rate-limited, whitelisted backtest API route"
```

### Task 22: Minimal `/trading-bot/backtest` UI with trade-ledger CSV export

**Files:**
- Create: `pixel-office/lib/backtest/csv.ts`
- Create: `pixel-office/components/trading-bot/BacktestPageClient.tsx`
- Create: `pixel-office/app/trading-bot/backtest/page.tsx`
- Test: `pixel-office/tests/backtest-csv.test.ts`

**Interfaces:**
- Consumes: `TradeLedgerEntry`, `BacktestResult` types (`@/lib/backtest/types`, only as
  `import type` from the client component — never a runtime import of `lib/backtest/`
  into a `"use client"` file, since that would bundle server-only Decimal/Prisma code
  into the browser); `PageShell`, `PixelCard`, `StatLine` (existing UI primitives).
- Produces: `tradeLedgerToCsv(entries: TradeLedgerEntry[]): string` (Task-local, pure,
  no DOM); `BacktestPageClient` component; the `/trading-bot/backtest` route.

- [ ] **Step 1: Write the failing test for CSV generation**

```ts
// pixel-office/tests/backtest-csv.test.ts
import { describe, it, expect } from "vitest";
import { tradeLedgerToCsv } from "@/lib/backtest/csv";
import type { TradeLedgerEntry } from "@/lib/backtest/types";

function trade(overrides: Partial<TradeLedgerEntry> = {}): TradeLedgerEntry {
  return {
    entryTime: 1000, entryPrice: "100", quantity: "1", entryNotional: "100", entryFee: "0.1",
    entryCost: "100.1", exitTime: 2000, exitPrice: "110", exitReason: "TP1", exitNotional: "110",
    exitFee: "0.11", exitProceeds: "109.89", realizedPnl: "9.79", intendedRiskBudget: "50",
    actualNetRisk: "49.5", actualRiskFraction: 0.00495, cashCapped: false, netRiskReward: 1.98,
    warnings: [],
    ...overrides,
  };
}

describe("tradeLedgerToCsv", () => {
  it("emits a header row followed by one row per trade", () => {
    const csv = tradeLedgerToCsv([trade()]);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("entryTime");
    expect(lines[0]).toContain("realizedPnl");
  });

  it("returns just the header row for an empty ledger", () => {
    const csv = tradeLedgerToCsv([]);
    expect(csv.trim().split("\n").length).toBe(1);
  });

  it("quotes a field that contains a comma (e.g. a joined warnings list)", () => {
    const csv = tradeLedgerToCsv([trade({ warnings: ["a, b", "c"] })]);
    expect(csv).toContain('"a, b; c"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pixel-office && npx vitest run tests/backtest-csv.test.ts`
Expected: FAIL — `Cannot find module '@/lib/backtest/csv'`.

- [ ] **Step 3: Write the CSV implementation**

```ts
// pixel-office/lib/backtest/csv.ts
//
// Trade-ledger-only CSV export (spec §12/§14 — no equity-curve CSV is offered, full-
// resolution or otherwise). Pure string formatting, no DOM — the UI component wires
// this to a client-side download.
import type { TradeLedgerEntry } from "./types";

const COLUMNS: (keyof TradeLedgerEntry)[] = [
  "entryTime", "entryPrice", "quantity", "entryNotional", "entryFee", "entryCost",
  "exitTime", "exitPrice", "exitReason", "exitNotional", "exitFee", "exitProceeds",
  "realizedPnl", "intendedRiskBudget", "actualNetRisk", "actualRiskFraction",
  "cashCapped", "netRiskReward", "warnings",
];

function csvField(value: unknown): string {
  const raw = Array.isArray(value) ? value.join("; ") : String(value);
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function tradeLedgerToCsv(entries: TradeLedgerEntry[]): string {
  const header = COLUMNS.join(",");
  const rows = entries.map((entry) => COLUMNS.map((col) => csvField(entry[col])).join(","));
  return [header, ...rows].join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pixel-office && npx vitest run tests/backtest-csv.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the page and client component** (no test — thin UI wiring over
  already-tested logic; verified manually in Task 24's acceptance checklist, matching
  the existing `TradingBotPageClient.tsx` precedent, which is also untested at the
  component level)

```tsx
// pixel-office/app/trading-bot/backtest/page.tsx
import BacktestPageClient from "@/components/trading-bot/BacktestPageClient";

export default function BacktestPage() {
  return <BacktestPageClient />;
}
```

```tsx
// pixel-office/components/trading-bot/BacktestPageClient.tsx
"use client";

import { useRef, useState } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { PixelCard, StatLine } from "@/components/ui/PixelCard";
import { tradeLedgerToCsv } from "@/lib/backtest/csv";
import type { BacktestResult, TradeLedgerEntry } from "@/lib/backtest/types";

const SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];

type Status = "idle" | "validating" | "running" | "done" | "error" | "cancelled";

function EquitySparkline({ points }: { points: { time: number; equity: string }[] }) {
  if (points.length < 2) return null;
  const values = points.map((p) => Number(p.equity));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 600;
  const height = 80;
  const path = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = max === min ? height / 2 : height - ((v - min) / (max - min)) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      role="img"
      aria-label={`Equity curve from ${values[0].toFixed(2)} to ${values[values.length - 1].toFixed(2)}`}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
    >
      <path d={path} fill="none" stroke="#f59e0b" strokeWidth={2} />
    </svg>
  );
}

function downloadCsv(entries: TradeLedgerEntry[], symbol: string) {
  const csv = tradeLedgerToCsv(entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backtest-${symbol.replace("/", "-")}-trade-ledger.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BacktestPageClient() {
  const [symbol, setSymbol] = useState(SYMBOLS[0]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [initialBalance, setInitialBalance] = useState("10000");
  const [feeRate, setFeeRate] = useState("0.001");
  const [spreadBps, setSpreadBps] = useState("5");
  const [slippageBps, setSlippageBps] = useState("5");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function run() {
    setStatus("validating");
    setError(null);
    const requestedStart = new Date(start).getTime();
    const requestedEnd = new Date(end).getTime();
    if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd) || requestedEnd <= requestedStart) {
      setStatus("error");
      setError("Enter a valid start and end date, with end after start.");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("running");
    try {
      const res = await fetch("/api/trading-bot/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          symbol,
          requestedStart,
          requestedEnd,
          initialBalance: Number(initialBalance),
          feeRate: Number(feeRate),
          spreadBps: Number(spreadBps),
          slippageBps: Number(slippageBps),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setStatus("error");
        setError(body.error ?? "Request failed");
        return;
      }
      const json = (await res.json()) as BacktestResult;
      setResult(json);
      setStatus("done");
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus("cancelled");
        setError(
          "Cancelled — in-flight and future historical-data requests were stopped immediately. " +
            "If computation had already started, it ran to completion and this response was discarded.",
        );
      } else {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Request failed");
      }
    }
  }

  function cancel() {
    controllerRef.current?.abort();
  }

  return (
    <PageShell accent="#f59e0b">
      <PixelCard title="Backtest — Deterministic, Long-Only, Paper-Only" accent="#f59e0b">
        <p className="text-xs text-warning">
          Historical simulation only — no real orders, no real money, no persistence. Confidence
          figures throughout are heuristic, not a probability of profit.
        </p>
      </PixelCard>

      <PixelCard title="Configuration" accent="#f59e0b">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>
            Symbol
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="block w-full border border-border bg-background px-2 py-1">
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Start (UTC)
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
          <label>
            End (UTC)
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
          <label>
            Initial balance (USDT)
            <input value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
          <label>
            Fee rate
            <input value={feeRate} onChange={(e) => setFeeRate(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
          <label>
            Spread (bps)
            <input value={spreadBps} onChange={(e) => setSpreadBps(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
          <label>
            Slippage (bps)
            <input value={slippageBps} onChange={(e) => setSlippageBps(e.target.value)} className="block w-full border border-border bg-background px-2 py-1" />
          </label>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={status === "running"}
            onClick={run}
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
          >
            {status === "running" ? "Running…" : "Run"}
          </button>
          <button
            type="button"
            disabled={status !== "running"}
            onClick={cancel}
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </PixelCard>

      {result ? (
        <>
          <PixelCard title="Metrics" accent="#f59e0b">
            <StatLine label="Net profit (USDT)" value={result.metrics.netProfit} />
            <StatLine label="Total return" value={`${(result.metrics.totalReturn * 100).toFixed(2)}%`} />
            <StatLine label="Win rate" value={`${(result.metrics.winRate * 100).toFixed(1)}%`} />
            <StatLine label="Profit factor" value={result.metrics.profitFactor?.toFixed(2) ?? (result.metrics.profitFactorReason ?? "n/a")} />
            <StatLine label="Max drawdown" value={`${(result.metrics.maxDrawdownPct * 100).toFixed(2)}%`} />
            <StatLine label="Sharpe (heuristic, per-bar)" value={result.metrics.sharpe?.toFixed(2) ?? "n/a (insufficient variance)"} />
            <StatLine label="Trades" value={String(result.metrics.tradeCount)} />
            <StatLine label="Buy-and-hold net profit (USDT)" value={(Number(result.benchmark.finalCash) - Number(result.config.initialBalance)).toFixed(2)} />
          </PixelCard>

          <PixelCard title="Equity Curve" accent="#f59e0b">
            <EquitySparkline points={result.equityCurveChart} />
          </PixelCard>

          <PixelCard title="Trade Ledger" accent="#f59e0b">
            <button
              type="button"
              onClick={() => downloadCsv(result.tradeLedger, result.symbol)}
              className="mb-2 rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5"
            >
              Download CSV
            </button>
            <div className="max-h-64 overflow-auto text-[10px]">
              {result.tradeLedger.map((t, i) => (
                <div key={i} className="border-t border-border/40 py-1 first:border-t-0">
                  {new Date(t.entryTime).toISOString()} @ {t.entryPrice} → {new Date(t.exitTime).toISOString()} @{" "}
                  {t.exitPrice} ({t.exitReason}) P&L {t.realizedPnl}
                </div>
              ))}
            </div>
          </PixelCard>

          <PixelCard title="Assumptions & Warnings" accent="#f59e0b">
            {result.warnings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data-quality warnings for this run.</p>
            ) : (
              result.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-muted-foreground">{w}</p>
              ))
            )}
            <p className="mt-2 text-[10px] text-muted-foreground/70">
              Malformed candles: {result.dataQuality.malformedCount}, invalid OHLC: {result.dataQuality.invalidOhlcCount}, gaps: {result.dataQuality.gapCount}.
            </p>
          </PixelCard>
        </>
      ) : null}
    </PageShell>
  );
}
```

- [ ] **Step 6: Manually verify the page renders** (dev server, no automated test —
  matches the existing pattern for `TradingBotPageClient.tsx`)

Run: `cd pixel-office && npm run dev`, visit `/trading-bot/backtest` signed in, confirm
the form renders and a Run click issues a `POST /api/trading-bot/backtest` (checked
properly end-to-end in Task 24's manual acceptance checklist, once real data is
available).

- [ ] **Step 7: Commit**

```bash
git add pixel-office/lib/backtest/csv.ts pixel-office/tests/backtest-csv.test.ts pixel-office/components/trading-bot/BacktestPageClient.tsx pixel-office/app/trading-bot/backtest/page.tsx
git commit -m "feat(backtest): add minimal backtest UI with trade-ledger CSV export"
```

---

### Task 23: Documentation — FEATURE_REGISTRY, ROADMAP, and the acceptance checklist

**Files:**
- Modify: `pixel-office/FEATURE_REGISTRY.md` (append a "Trading Bot — Backtesting
  (Phase 3)" section, mirroring the existing Phase 1/Phase 2 section format)
- Modify: `pixel-office/ROADMAP.md` (add a Phase 3 entry under "Backlog" moved to an
  "Implementation complete — acceptance pending" section, mirroring Phase 1/2's prior
  pattern)
- Create: `docs/superpowers/specs/2026-07-15-trading-bot-phase3-acceptance-checklist.md`

**Interfaces:** none — documentation only, no code.

- [ ] **Step 1: Write `FEATURE_REGISTRY.md`'s Phase 3 section**

Append a section titled `## Trading Bot — Backtesting (Phase 3)` describing: scope
(single-symbol, 4h-primary, long-only, deterministic, no persistence); the reused
signal engine; the corrected decision-bar/tradable-bar boundary model; the risk-based
sizing/hard risk cap; the empirically-verified MEXC pagination contract; the 2 MB
self-imposed response cap and trade-ledger-only CSV export; a link to the design spec
and this implementation plan; **Status: Implementation complete; authenticated
interactive acceptance pending.**

- [ ] **Step 2: Write `ROADMAP.md`'s Phase 3 entry**

Add `### AI Trading Bot — Phase 3, Deterministic Backtesting` under a "## Implementation
complete — acceptance pending" section (recreate this heading if Phase 2's version was
folded into Completed already), with the same status line as Step 1, and update the
Backlog's "AI Trading Bot Phase 3+" bullet to note Phase 3 backtesting is
implementation-complete (Phase 4+ remain future work, unchanged).

- [ ] **Step 3: Write the acceptance checklist**

```markdown
# AI Trading Bot — Phase 3 Acceptance Checklist

Status of the implementation: complete, automated gates passing; authenticated
interactive acceptance by the repository owner is the remaining step before Phase 3 is
marked Accepted.

## How to run this checklist

\`\`\`bash
cd pixel-office
npm run dev
\`\`\`

Open `http://localhost:3000/trading-bot/backtest` signed in, DevTools Console open.

## Checklist

### 1. Authenticated access
Visit signed out — redirected/401. Sign in — page renders, no console errors.

### 2. A real MEXC-backed run completes and returns a coherent result
Run BTC/USDT over a 90-day range with defaults. Confirm: requested/fetched-warmup/
actual-evaluation ranges are all shown and distinct; candle counts are non-zero; the
metrics block and equity curve render; the buy-and-hold comparison is present.

### 3. Hand-verify one trade from the ledger
Pick one closed trade; manually recompute its `realizedPnl` from `entryPrice`,
`exitPrice`, `quantity`, and the configured fee/spread/slippage using the formulas in
the design spec §8.4; confirm it matches the ledger row.

### 4. CSV export
Click "Download CSV"; confirm the file opens in a spreadsheet with one row per trade
and the header matches the ledger's fields. Confirm no equity-curve CSV is offered
anywhere on the page.

### 5. Cancel behavior matches the documented, non-overclaiming copy
Start a run, click Cancel promptly. Confirm the UI shows the exact cancellation copy
from `BacktestPageClient.tsx` (network-phase-only, not "stops all server work").

### 6. Oversized/invalid input is rejected cleanly
Try a >365-day range, an out-of-bounds initial balance, and an unsupported symbol
(via direct API call). Confirm each returns 400 with a clear message, not a crash.

### 7. Browser console stays clean
No uncaught exceptions or React errors throughout items 1–6.

### 8. No execution/broker capability is reachable
Confirm nothing on this page places, cancels, or references a real order — this is a
read-only historical simulation.

## Result

Pending — to be completed by the repository owner.
```

- [ ] **Step 4: Commit**

```bash
git add pixel-office/FEATURE_REGISTRY.md pixel-office/ROADMAP.md docs/superpowers/specs/2026-07-15-trading-bot-phase3-acceptance-checklist.md
git commit -m "docs(trading-bot): add Phase 3 FEATURE_REGISTRY/ROADMAP entries and acceptance checklist"
```

---

### Task 24: Full verification — tests, typecheck, lint, build, bounded performance

**Files:** none created — verification only.

- [ ] **Step 1: Run the full deterministic test suite**

Run: `cd pixel-office && npm test`
Expected: exit 0, every `backtest-*`/`historical-candles*`/`trading-bot-backtest-route`/
`trading-signals-safety` test passing alongside the full pre-existing Phase 1/2 suite —
no regression.

- [ ] **Step 2: Run the isolated live-provider check (not part of the default suite)**

Run: `cd pixel-office && npm run test:live`
Expected: exit 0 (one bounded, read-only, 10s-capped MEXC request).

- [ ] **Step 3: Typecheck**

Run: `cd pixel-office && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Lint**

Run: `cd pixel-office && npm run lint`
Expected: exit 0.

- [ ] **Step 5: Build**

Run: `cd pixel-office && npm run build`
Expected: exit 0; `/trading-bot/backtest` and `/api/trading-bot/backtest` present in
the route manifest.

- [ ] **Step 6: Bounded performance check**

Add a one-off (not committed as a permanent test — run manually and record the result
in the checkpoint report) script exercising `runBacktest` against a synthetic ~2,200-bar
primary series (a full 1-year 4h range) plus proportional 1h/1d confirmation series,
timing the call:

```ts
// scratch, not committed — run with: npx tsx scratch-perf.ts
import { performance } from "node:perf_hooks";
// ... build a 2200-bar primary series + ~17,520-bar 1h series + ~415-bar 1d series
// the same way tests/backtest-run-backtest.test.ts's fixtures do, at 1-year scale ...
const t0 = performance.now();
runBacktest(primary, oneHour, oneDay, window, config);
console.log(`runBacktest: ${(performance.now() - t0).toFixed(0)}ms`);
```

Expected: comfortably under the ~15s compute-phase budget implied by the 55s internal
deadline (spec §9.1). Record the actual number in the checkpoint report; if it is not
comfortably under budget, that is a blocking finding to raise before Phase 3 is
accepted, not something to silently absorb.

- [ ] **Step 7: Final `git status` check**

Run: `cd "T:\Claude Code\Ai Agent" && git status --short`
Expected: every file this plan touched is committed; the only remaining uncommitted
entry is the pre-existing, unrelated `pixel-office/components/portfolio/ui.tsx` — never
staged by this plan.

**Checkpoint 5 report gate — end of plan:** report every commit hash from Checkpoints
1–5, the full test count, the bounded performance number from Step 6, and explicit
confirmation that `portfolio/ui.tsx` was never staged.

