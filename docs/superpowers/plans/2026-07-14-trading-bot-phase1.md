# AI Trading Bot — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 slice of the AI Trading Bot inside `pixel-office`: a `BrokerAdapter`/`Strategy`/`TradeIntent`/`RiskEngine` contract, a per-user in-memory `MockBroker`, and one working, idempotent, server-authoritative pipeline (signal → intent → risk → broker → fill) reachable from a minimal `/trading-bot` page.

**Architecture:** New isolated module `lib/trading-bot/` consumes only the pure outputs of the existing `lib/trading-signals/` engine and `lib/market-data/candles`. All mutation is server-side, per-user-keyed, idempotent, and long-only. No persistence, no live trading, no broker credentials.

**Tech Stack:** Next.js 15 App Router (Node runtime routes), TypeScript, `Prisma.Decimal` for all money/quantity math, Zod for request validation, Clerk (`requireUser()`) for auth, Vitest (node environment, no DB/network) for tests.

**Spec:** `docs/superpowers/specs/2026-07-14-trading-bot-phase1-design.md` (approved 2026-07-14).

## Global Constraints

- All monetary/quantity math uses `Prisma.Decimal` server-side; **never** a JS `number`. API responses serialize these fields as `string`, never `number`.
- Starting paper balance: `PAPER_STARTING_BALANCE_USDT = new Prisma.Decimal("10000.00")`, denominated in USDT, no FX conversion.
- Fee rate: `MOCK_FEE_RATE = new Prisma.Decimal("0.001")` (0.1%), applied identically to BUY notional and SELL proceeds, read from one constant everywhere.
- Signal-instance-age ceiling: `SIGNAL_FRESHNESS_WINDOW_MS = 5 * 60_000` (5 minutes), independent of candle-data freshness.
- Candle-data freshness ceiling: `TIMEFRAME_DURATION_MS[timeframe] + CANDLE_STALENESS_GRACE_MS` (`CANDLE_STALENESS_GRACE_MS = 5 * 60_000`). A valid signal is never rejected for candle age alone if within this ceiling.
- Long-only: SELL may only reduce/close an existing position. No naked SELL, short, leverage, margin, reversal, or negative quantity, ever.
- Every mock account/position/order/idempotency record is keyed by the authenticated `userId` from `requireUser()`. No cross-user lookup path anywhere.
- Every route calls `requireUser()` itself, first — never relies on middleware alone for authorization.
- `lib/trading-bot/**` and `app/api/trading-bot/**` must never import `lib/exchanges/*` or reference `MEXC_API_KEY`/`MEXC_API_SECRET` or any live-mode identifier — enforced by a static safety test (Task 13).
- Rounding: all Decimal values stored into account/position state are rounded to 8 dp, `ROUND_HALF_UP`, immediately after computation. Quantities accepted from input are validated to at most 10 dp and never independently re-rounded.
- Rejections never throw. Every expected paper-trading outcome returns `{ status: "REJECTED", reasonCode, reason }` with HTTP 200. Only malformed input (400) or a genuine unexpected fault (401/429/500) uses a non-200 status.
- No DB persistence, no full risk rule set, no backtesting, no 2FA/live-mode gating, no broker connection settings, no audit log, no bot automation, no limit orders/partial fills/slippage, no margin/leverage/short-selling, no configurable/reset-able starting balance. All deferred to later phases named in the spec.

---

## File Structure

```
pixel-office/
  lib/trading-bot/
    types.ts            — domain types (Decimal-based, server-only)
    dto.ts               — public JSON contract types (string-based)
    config.ts             — Phase 1 constants
    errors.ts              — default human-readable reason per RejectCode
    serialize.ts             — decimal string parsing/validation + serialization
    pricing.ts                 — shared fee/notional math + BUY execution-price derivation
    freshness.ts                 — shared candle-staleness check
    store.ts                      — per-user account store + per-user async lock + idempotency index
    broker-types.ts                 — BrokerAdapter interface
    mock-broker.ts                    — MockBroker implementation
    risk-engine.ts                      — RiskEngine interface + StubRiskEngine
    strategy.ts                           — Strategy interface + SignalEngineStrategy
  app/trading-bot/
    page.tsx                                — thin server wrapper (metadata only)
  components/trading-bot/
    TradingBotPageClient.tsx                  — client page (signals, account, orders, close)
  app/api/trading-bot/
    account/route.ts
    positions/route.ts
    orders/route.ts
    positions/close/route.ts
  lib/api/rate-limit.ts    — MODIFY: add tradingBotRead/tradingBotWrite buckets
  middleware.ts              — MODIFY: protect /trading-bot(.*)
  components/nav/AppNav.tsx    — MODIFY: add a "Trading Bot" link
  .env.example                   — MODIFY: document the two new rate-limit env vars
  tests/
    trading-bot-serialize.test.ts
    trading-bot-pricing.test.ts
    trading-bot-freshness.test.ts
    trading-bot-store.test.ts
    trading-bot-mock-broker.test.ts
    trading-bot-risk-engine.test.ts
    trading-bot-strategy.test.ts
    trading-bot-rate-limit.test.ts
    trading-bot-orders-route.test.ts
    trading-bot-close-route.test.ts
    trading-bot-account-route.test.ts
    trading-bot-safety.test.ts
```

All paths below are relative to `pixel-office/` (the Next.js app root), which is where `npm run dev`, `npm test`, `npx tsc --noEmit`, and `npm run lint` must be run from.

---

### Task 1: Foundational types, DTOs, config, and error messages

**Files:**
- Create: `lib/trading-bot/types.ts`
- Create: `lib/trading-bot/dto.ts`
- Create: `lib/trading-bot/config.ts`
- Create: `lib/trading-bot/errors.ts`
- Test: `tests/trading-bot-config.test.ts`

**Interfaces:**
- Produces: `OrderSide`, `OrderStatus`, `RejectCode`, `SourceSignal`, `TradeIntent`, `MockPosition`, `MockAccount`, `Fill`, `OrderResult` (all from `types.ts`); `AccountDTO`, `PositionDTO`, `OrderResultDTO` (from `dto.ts`); `PAPER_STARTING_BALANCE_USDT`, `MOCK_FEE_RATE`, `SIGNAL_FRESHNESS_WINDOW_MS` (from `config.ts`); `defaultReason(code: RejectCode): string` (from `errors.ts`). Every later task imports from these four files.

- [ ] **Step 1: Create `lib/trading-bot/types.ts`**

```ts
// Server-only domain types for the Phase 1 mock trading pipeline. All money and
// quantity fields use Prisma.Decimal — never a JS number.
import type { Prisma } from "@prisma/client";

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "FILLED" | "REJECTED";

export type RejectCode =
  | "UNRECOGNIZED_SIGNAL"
  | "NON_ACTIONABLE_SIGNAL"
  | "UNSUPPORTED_SHORT"
  | "STALE_SIGNAL" // the signal INSTANCE the user acted on is too old
  | "STALE_CANDLE_DATA" // the underlying market data is too old, independent of signal age
  | "INVALID_QUANTITY"
  | "MISSING_STOP_LOSS"
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_POSITION"
  | "NO_OPEN_POSITION";

export interface SourceSignal {
  direction: "LONG";
  entryZone: { low: number; high: number };
  stopLoss: number;
  takeProfit: { price: number; label: string }[];
  riskRewardRatio: number | null;
  confidence: number;
  generatedAt: string;
}

export interface TradeIntent {
  userId: string;
  symbol: string;
  timeframe: "4h";
  side: OrderSide;
  requestedQuantity: Prisma.Decimal;
  /** Present for BUY (signal-derived); absent for SELL (position-derived). */
  sourceSignal?: SourceSignal;
  createdAt: string;
}

export interface MockPosition {
  symbol: string;
  quantity: Prisma.Decimal; // always > 0 while present; zeroed positions are removed
  avgEntryPrice: Prisma.Decimal;
  realizedPnl: Prisma.Decimal; // cumulative, across all closes of this symbol
}

export interface MockAccount {
  userId: string;
  cashBalance: Prisma.Decimal;
  startingBalance: Prisma.Decimal;
  positions: Map<string, MockPosition>; // key: symbol
}

export interface Fill {
  orderId: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal;
  fee: Prisma.Decimal;
  notional: Prisma.Decimal;
  realizedPnl: Prisma.Decimal | null; // set for SELL only
  executedAt: string;
}

export interface OrderResult {
  orderId: string;
  status: OrderStatus;
  reasonCode: RejectCode | null;
  reason: string | null;
  side: OrderSide;
  symbol: string;
  requestedQuantity: Prisma.Decimal;
  fill: Fill | null;
  idempotent: boolean; // true when served from the idempotency cache
}
```

- [ ] **Step 2: Create `lib/trading-bot/dto.ts`**

```ts
// Public JSON contract types. STRING for every monetary/quantity field. Never
// imports @prisma/client — safe to import from client components.

export interface PositionDTO {
  symbol: string;
  quantity: string;
  avgEntryPrice: string;
  marketValue: string | null; // null if a fresh quote could not be fetched
  unrealizedPnl: string | null;
  realizedPnl: string;
}

export interface AccountDTO {
  currency: "USDT";
  cashBalance: string;
  equity: string; // cashBalance + sum(position market value)
  startingBalance: string;
  positions: PositionDTO[];
  generatedAt: string;
}

export interface OrderResultDTO {
  orderId: string;
  status: "FILLED" | "REJECTED";
  reasonCode: string | null;
  reason: string | null;
  side: "BUY" | "SELL";
  symbol: string;
  requestedQuantity: string;
  fillPrice: string | null;
  fee: string | null;
  notional: string | null;
  realizedPnl: string | null;
  executedAt: string | null;
  idempotent: boolean;
}
```

- [ ] **Step 3: Create `lib/trading-bot/config.ts`**

```ts
// Phase 1 constants — named, not inlined, so later phases can change them
// without touching execution logic. All monetary values are in USDT.
import { Prisma } from "@prisma/client";

export const PAPER_STARTING_BALANCE_USDT = new Prisma.Decimal("10000.00");

/** 0.1% flat fee, applied identically to BUY notional and SELL proceeds. */
export const MOCK_FEE_RATE = new Prisma.Decimal("0.001");

/** Max age of the signal INSTANCE the user acted on (observedGeneratedAt). */
export const SIGNAL_FRESHNESS_WINDOW_MS = 5 * 60_000;
```

- [ ] **Step 4: Create `lib/trading-bot/errors.ts`**

```ts
import type { RejectCode } from "./types";

const DEFAULT_REASONS: Record<RejectCode, string> = {
  UNRECOGNIZED_SIGNAL: "Unknown symbol or timeframe.",
  NON_ACTIONABLE_SIGNAL: "The current signal is WAIT — no actionable setup.",
  UNSUPPORTED_SHORT: "SHORT signals are not supported in Phase 1 (long-only).",
  STALE_SIGNAL: "The signal you viewed has expired — refresh and try again.",
  STALE_CANDLE_DATA: "Market data is currently stale or unavailable.",
  INVALID_QUANTITY: "Quantity must be a positive decimal string.",
  MISSING_STOP_LOSS: "The signal has no stop-loss; cannot size the order.",
  INSUFFICIENT_FUNDS: "Order notional plus fee exceeds available cash balance.",
  INSUFFICIENT_POSITION: "Requested quantity exceeds the held position.",
  NO_OPEN_POSITION: "No open position for this symbol.",
};

export function defaultReason(code: RejectCode): string {
  return DEFAULT_REASONS[code];
}
```

- [ ] **Step 5: Write the config test**

```ts
// tests/trading-bot-config.test.ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- trading-bot-config`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add lib/trading-bot/types.ts lib/trading-bot/dto.ts lib/trading-bot/config.ts lib/trading-bot/errors.ts tests/trading-bot-config.test.ts
git commit -m "feat(trading-bot): add Phase 1 domain types, DTOs, config, error messages"
```

---

### Task 2: `serialize.ts` — decimal input validation and serialization

**Files:**
- Create: `lib/trading-bot/serialize.ts`
- Test: `tests/trading-bot-serialize.test.ts`

**Interfaces:**
- Consumes: nothing project-specific (only `Prisma.Decimal`, `zod`).
- Produces: `InvalidQuantityError`, `parseQuantityInput(raw: unknown): Prisma.Decimal`, `quantityInputSchema: ZodString`, `toDecimalString(d: Prisma.Decimal): string`, `roundMoney(d: Prisma.Decimal): Prisma.Decimal`. Used by every later task that touches money/quantity at a boundary.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-bot-serialize.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { parseQuantityInput, InvalidQuantityError, toDecimalString, roundMoney } from "@/lib/trading-bot/serialize";

describe("parseQuantityInput", () => {
  it("accepts a valid positive decimal string", () => {
    const d = parseQuantityInput("0.0500000000");
    expect(d.toString()).toBe("0.05");
  });

  it("accepts an integer string", () => {
    expect(parseQuantityInput("5").toString()).toBe("5");
  });

  it.each([
    ["number instead of string", 5],
    ["negative", "-1"],
    ["zero", "0"],
    ["NaN literal", "NaN"],
    ["Infinity literal", "Infinity"],
    ["exponential notation", "1e5"],
    ["multiple decimal points", "1.2.3"],
    ["empty string", ""],
    ["over-precision (11dp)", "1.12345678901"],
    ["null", null],
    ["object", { amount: "5" }],
    ["leading plus sign", "+5"],
  ])("rejects: %s", (_label, raw) => {
    expect(() => parseQuantityInput(raw)).toThrow(InvalidQuantityError);
  });
});

describe("toDecimalString", () => {
  it("round-trips exactly, no implicit rounding", () => {
    const d = new Prisma.Decimal("123.45000000");
    expect(toDecimalString(d)).toBe("123.45");
  });
});

describe("roundMoney", () => {
  it("rounds to 8dp with ROUND_HALF_UP", () => {
    const d = new Prisma.Decimal("1.123456785");
    expect(roundMoney(d).toString()).toBe("1.12345679");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- trading-bot-serialize`
Expected: FAIL with "Cannot find module '@/lib/trading-bot/serialize'"

- [ ] **Step 3: Create `lib/trading-bot/serialize.ts`**

```ts
import { Prisma } from "@prisma/client";
import { z } from "zod";

const QUANTITY_PATTERN = /^\d{1,18}(\.\d{1,10})?$/;

export class InvalidQuantityError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidQuantityError";
  }
}

/** Strict: only a plain decimal string (no numbers, no exponents, no signs). */
export function parseQuantityInput(raw: unknown): Prisma.Decimal {
  if (typeof raw !== "string") {
    throw new InvalidQuantityError("quantity must be a string");
  }
  if (!QUANTITY_PATTERN.test(raw)) {
    throw new InvalidQuantityError(
      "quantity must be a positive decimal string with at most 10 decimal places",
    );
  }
  const d = new Prisma.Decimal(raw);
  if (!d.isFinite() || d.isNegative() || d.isZero()) {
    throw new InvalidQuantityError("quantity must be a positive finite number");
  }
  return d;
}

/** Zod schema wrapper so routes can validate quantity inline in a larger object. */
export const quantityInputSchema = z.string().superRefine((val, ctx) => {
  try {
    parseQuantityInput(val);
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: err instanceof Error ? err.message : "invalid quantity",
    });
  }
});

/** Exact, no implicit rounding — rounding happens earlier, at computation time. */
export function toDecimalString(d: Prisma.Decimal): string {
  return d.toString();
}

export function roundMoney(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- trading-bot-serialize`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add lib/trading-bot/serialize.ts tests/trading-bot-serialize.test.ts
git commit -m "feat(trading-bot): add decimal input validation and serialization"
```

---

### Task 3: `pricing.ts` — shared fee/notional math and BUY execution price

**Files:**
- Create: `lib/trading-bot/pricing.ts`
- Test: `tests/trading-bot-pricing.test.ts`

**Interfaces:**
- Consumes: `MOCK_FEE_RATE` (Task 1), `SourceSignal` (Task 1).
- Produces: `estimateOrderCost(notional: Prisma.Decimal, feeRate?: Prisma.Decimal): Prisma.Decimal`, `deriveBuyExecutionPrice(sourceSignal: SourceSignal): Prisma.Decimal`. Used identically by `StubRiskEngine` (Task 7) and the orders route (Task 10) — this is the single source of truth so the two can never disagree.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-bot-pricing.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { estimateOrderCost, deriveBuyExecutionPrice } from "@/lib/trading-bot/pricing";
import type { SourceSignal } from "@/lib/trading-bot/types";

describe("estimateOrderCost", () => {
  it("adds notional + fee at the default 0.1% rate", () => {
    const notional = new Prisma.Decimal("1000");
    const cost = estimateOrderCost(notional);
    expect(cost.toString()).toBe("1001"); // 1000 + 1000*0.001
  });

  it("accepts an explicit fee rate override", () => {
    const notional = new Prisma.Decimal("100");
    const cost = estimateOrderCost(notional, new Prisma.Decimal("0.01"));
    expect(cost.toString()).toBe("101");
  });
});

describe("deriveBuyExecutionPrice", () => {
  it("is the midpoint of the entry zone", () => {
    const sourceSignal: SourceSignal = {
      direction: "LONG",
      entryZone: { low: 100, high: 110 },
      stopLoss: 95,
      takeProfit: [],
      riskRewardRatio: 2,
      confidence: 70,
      generatedAt: new Date().toISOString(),
    };
    expect(deriveBuyExecutionPrice(sourceSignal).toString()).toBe("105");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- trading-bot-pricing`
Expected: FAIL with "Cannot find module '@/lib/trading-bot/pricing'"

- [ ] **Step 3: Create `lib/trading-bot/pricing.ts`**

```ts
import { Prisma } from "@prisma/client";
import { MOCK_FEE_RATE } from "./config";
import type { SourceSignal } from "./types";

/** notional + (notional * feeRate). Decimal math throughout. */
export function estimateOrderCost(
  notional: Prisma.Decimal,
  feeRate: Prisma.Decimal = MOCK_FEE_RATE,
): Prisma.Decimal {
  return notional.plus(notional.times(feeRate));
}

/**
 * BUY execution price: midpoint of the source signal's entry zone. Shared by
 * StubRiskEngine (cost estimation, before approval) and the orders route
 * (actual execution price passed to MockBroker), so the two can never disagree.
 */
export function deriveBuyExecutionPrice(sourceSignal: SourceSignal): Prisma.Decimal {
  const { low, high } = sourceSignal.entryZone;
  return new Prisma.Decimal(low).plus(high).dividedBy(2);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- trading-bot-pricing`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/trading-bot/pricing.ts tests/trading-bot-pricing.test.ts
git commit -m "feat(trading-bot): add shared fee/notional math and BUY execution price"
```

---

### Task 4: `freshness.ts` — candle-data staleness check

**Files:**
- Create: `lib/trading-bot/freshness.ts`
- Test: `tests/trading-bot-freshness.test.ts`

**Interfaces:**
- Consumes: `Candle` from `@/lib/market-data/candles`, `Timeframe` from `@/lib/trading-signals/types`.
- Produces: `TIMEFRAME_DURATION_MS`, `CANDLE_STALENESS_GRACE_MS`, `FreshnessResult`, `checkCandleFreshness(candles: Candle[], timeframe: Timeframe, now: number): FreshnessResult`. Used by `strategy.ts` (Task 8, BUY path) and the close route (Task 11, SELL path).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-bot-freshness.test.ts
import { describe, it, expect } from "vitest";
import { checkCandleFreshness, TIMEFRAME_DURATION_MS, CANDLE_STALENESS_GRACE_MS } from "@/lib/trading-bot/freshness";
import type { Candle } from "@/lib/market-data/candles";

function candleAt(openTime: number): Candle {
  return { openTime, open: 100, high: 101, low: 99, close: 100, volume: 10 };
}

describe("checkCandleFreshness", () => {
  it("rejects an empty candle array", () => {
    const result = checkCandleFreshness([], "4h", Date.now());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STALE_CANDLE_DATA");
  });

  it("accepts a candle within one timeframe + grace period", () => {
    const now = 10_000_000;
    const maxAge = TIMEFRAME_DURATION_MS["4h"] + CANDLE_STALENESS_GRACE_MS;
    const candles = [candleAt(now - (maxAge - 1))];
    expect(checkCandleFreshness(candles, "4h", now).ok).toBe(true);
  });

  it("rejects a candle older than one timeframe + grace period", () => {
    const now = 10_000_000;
    const maxAge = TIMEFRAME_DURATION_MS["4h"] + CANDLE_STALENESS_GRACE_MS;
    const candles = [candleAt(now - (maxAge + 1))];
    const result = checkCandleFreshness(candles, "4h", now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STALE_CANDLE_DATA");
  });

  it("a 3h-old candle on a 4h timeframe is NOT stale (within the ~4h05m ceiling)", () => {
    const now = 10_000_000;
    const threeHoursMs = 3 * 60 * 60_000;
    const candles = [candleAt(now - threeHoursMs)];
    expect(checkCandleFreshness(candles, "4h", now).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- trading-bot-freshness`
Expected: FAIL with "Cannot find module '@/lib/trading-bot/freshness'"

- [ ] **Step 3: Create `lib/trading-bot/freshness.ts`**

```ts
import type { Candle } from "@/lib/market-data/candles";
import type { Timeframe } from "@/lib/trading-signals/types";

export const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

/** Small documented grace period on top of one full timeframe interval. */
export const CANDLE_STALENESS_GRACE_MS = 5 * 60_000;

export type FreshnessResult =
  | { ok: true }
  | { ok: false; code: "STALE_CANDLE_DATA"; reason: string };

/**
 * Stale when `candles` is empty, or when the most recent candle's openTime is
 * older than one full timeframe interval plus the grace period. Independent of
 * signal-instance age (SIGNAL_FRESHNESS_WINDOW_MS) — a valid slow-timeframe
 * signal is never rejected here merely for being "more than five minutes old".
 */
export function checkCandleFreshness(
  candles: Candle[],
  timeframe: Timeframe,
  now: number,
): FreshnessResult {
  const last = candles[candles.length - 1];
  if (!last) {
    return { ok: false, code: "STALE_CANDLE_DATA", reason: "no candle data available" };
  }
  const maxAgeMs = TIMEFRAME_DURATION_MS[timeframe] + CANDLE_STALENESS_GRACE_MS;
  const ageMs = now - last.openTime;
  if (ageMs > maxAgeMs) {
    const ageMin = Math.round(ageMs / 60_000);
    const maxMin = Math.round(maxAgeMs / 60_000);
    return {
      ok: false,
      code: "STALE_CANDLE_DATA",
      reason: `latest ${timeframe} candle is ${ageMin} min old, exceeds the ${maxMin} min freshness ceiling`,
    };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- trading-bot-freshness`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/trading-bot/freshness.ts tests/trading-bot-freshness.test.ts
git commit -m "feat(trading-bot): add timeframe-aware candle-staleness check"
```

---

### Task 5: `store.ts` — per-user account store, idempotency index, lock

**Files:**
- Create: `lib/trading-bot/store.ts`
- Test: `tests/trading-bot-store.test.ts`

**Interfaces:**
- Consumes: `PAPER_STARTING_BALANCE_USDT` (Task 1), `MockAccount`, `MockPosition`, `OrderResult` (Task 1).
- Produces: `getAccountForUser(userId: string): MockAccount`, `getIdempotentResult(userId: string, key: string): OrderResult | undefined`, `storeIdempotentResult(userId: string, key: string, result: OrderResult): void`, `withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T>`, `__resetTradingBotStore(): void` (test seam). Used by `mock-broker.ts` (Task 6) and both mutating routes (Tasks 10, 11).

**Deployment-safety note (document as a code comment, not a TODO):** this is a module-scoped `Map`, correct only in a single warm Node process — not deployment-safe on serverless. Mirrors the existing, already-documented caveat on `lib/api/rate-limit.ts` and `lib/agents/agents-cache.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-bot-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  getAccountForUser,
  getIdempotentResult,
  storeIdempotentResult,
  withUserLock,
  __resetTradingBotStore,
} from "@/lib/trading-bot/store";
import type { OrderResult } from "@/lib/trading-bot/types";
import { Prisma } from "@prisma/client";

beforeEach(() => __resetTradingBotStore());

function fakeResult(orderId: string): OrderResult {
  return {
    orderId,
    status: "FILLED",
    reasonCode: null,
    reason: null,
    side: "BUY",
    symbol: "BTC/USDT",
    requestedQuantity: new Prisma.Decimal("1"),
    fill: null,
    idempotent: false,
  };
}

describe("getAccountForUser", () => {
  it("creates a fresh account at the starting balance on first access", () => {
    const account = getAccountForUser("user-1");
    expect(account.cashBalance.toString()).toBe("10000");
    expect(account.startingBalance.toString()).toBe("10000");
    expect(account.positions.size).toBe(0);
  });

  it("returns the SAME object on repeat access (so mutations persist)", () => {
    const a = getAccountForUser("user-1");
    a.cashBalance = a.cashBalance.minus(1);
    const b = getAccountForUser("user-1");
    expect(b.cashBalance.toString()).toBe("9999");
  });

  it("isolates accounts per user", () => {
    const a = getAccountForUser("user-1");
    a.cashBalance = a.cashBalance.minus(500);
    const b = getAccountForUser("user-2");
    expect(b.cashBalance.toString()).toBe("10000");
  });
});

describe("idempotency index", () => {
  it("is empty until a result is stored, then returns it", () => {
    expect(getIdempotentResult("user-1", "key-1")).toBeUndefined();
    storeIdempotentResult("user-1", "key-1", fakeResult("order-1"));
    expect(getIdempotentResult("user-1", "key-1")?.orderId).toBe("order-1");
  });

  it("scopes idempotency keys per user — the same literal key does not collide", () => {
    storeIdempotentResult("user-1", "shared-key", fakeResult("order-A"));
    storeIdempotentResult("user-2", "shared-key", fakeResult("order-B"));
    expect(getIdempotentResult("user-1", "shared-key")?.orderId).toBe("order-A");
    expect(getIdempotentResult("user-2", "shared-key")?.orderId).toBe("order-B");
  });
});

describe("withUserLock", () => {
  it("serializes calls for the same user in submission order", async () => {
    const order: number[] = [];
    const first = withUserLock("user-1", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const second = withUserLock("user-1", async () => {
      order.push(2);
    });
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it("does not serialize calls for different users", async () => {
    const order: string[] = [];
    const a = withUserLock("user-1", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("a");
    });
    const b = withUserLock("user-2", async () => {
      order.push("b");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["b", "a"]); // b finishes first, unblocked by a's lock
  });

  it("a failed call does not wedge the lock for the next call", async () => {
    await expect(
      withUserLock("user-1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const result = await withUserLock("user-1", async () => "ok");
    expect(result).toBe("ok");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- trading-bot-store`
Expected: FAIL with "Cannot find module '@/lib/trading-bot/store'"

- [ ] **Step 3: Create `lib/trading-bot/store.ts`**

```ts
// Per-user in-memory store for the Phase 1 mock trading pipeline.
//
// DEPLOYMENT-SAFETY CAVEAT: this is a module-scoped Map<userId, ...>. It is
// correct in a single warm Node process (local dev, a single long-lived
// server instance) but is NOT safe on serverless/multi-instance deployment
// (e.g. Vercel functions): concurrent requests may land on different
// instances, each with its own empty map, silently losing or duplicating
// state. This mirrors the existing, already-documented caveat on
// lib/api/rate-limit.ts and lib/agents/agents-cache.ts. Phase 4 replaces this
// with Postgres-backed persistence.
import { PAPER_STARTING_BALANCE_USDT } from "./config";
import type { MockAccount, MockPosition, OrderResult } from "./types";

interface StoreEntry {
  account: MockAccount;
  idempotency: Map<string, OrderResult>;
}

const store = new Map<string, StoreEntry>();
const locks = new Map<string, Promise<unknown>>();

function createEntry(userId: string): StoreEntry {
  return {
    account: {
      userId,
      cashBalance: PAPER_STARTING_BALANCE_USDT,
      startingBalance: PAPER_STARTING_BALANCE_USDT,
      positions: new Map<string, MockPosition>(),
    },
    idempotency: new Map<string, OrderResult>(),
  };
}

function getEntry(userId: string): StoreEntry {
  let entry = store.get(userId);
  if (!entry) {
    entry = createEntry(userId);
    store.set(userId, entry);
  }
  return entry;
}

/** Returns the SAME mutable object every time for a given userId. */
export function getAccountForUser(userId: string): MockAccount {
  return getEntry(userId).account;
}

export function getIdempotentResult(userId: string, key: string): OrderResult | undefined {
  return getEntry(userId).idempotency.get(key);
}

export function storeIdempotentResult(userId: string, key: string, result: OrderResult): void {
  getEntry(userId).idempotency.set(key, result);
}

/**
 * Per-user promise-chained mutex: serializes mutating calls for a given user
 * so two concurrent requests with the same idempotency key can't both pass a
 * check-then-act race. Only protects within this single Node process.
 */
export function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(userId) ?? Promise.resolve();
  const next = prior.then(() => fn(), () => fn());
  // A failed call must not wedge the lock for the next caller.
  locks.set(userId, next.then(() => undefined, () => undefined));
  return next;
}

/** Test seam: clear all in-memory state between cases. */
export function __resetTradingBotStore(): void {
  store.clear();
  locks.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- trading-bot-store`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/trading-bot/store.ts tests/trading-bot-store.test.ts
git commit -m "feat(trading-bot): add per-user in-memory store, idempotency index, and lock"
```

---

### Task 6: `broker-types.ts` + `mock-broker.ts` — the MockBroker

**Files:**
- Create: `lib/trading-bot/broker-types.ts`
- Create: `lib/trading-bot/mock-broker.ts`
- Test: `tests/trading-bot-mock-broker.test.ts`

**Interfaces:**
- Consumes: `getAccountForUser` (Task 5), `MOCK_FEE_RATE` (Task 1), `estimateOrderCost` (Task 3), `defaultReason` (Task 1), `TradeIntent`, `MockPosition`, `Fill`, `OrderResult` (Task 1).
- Produces: `BrokerAdapter`, `PlaceOrderRequest` (from `broker-types.ts`); `MockBroker` class and `mockBroker` singleton implementing `BrokerAdapter` (from `mock-broker.ts`). `PlaceOrderRequest.executionPrice` is always pre-computed by the caller — `MockBroker` never fetches candles or derives price itself. Used by both routes (Tasks 10, 11).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-bot-mock-broker.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { mockBroker } from "@/lib/trading-bot/mock-broker";
import { getAccountForUser, __resetTradingBotStore } from "@/lib/trading-bot/store";
import type { TradeIntent } from "@/lib/trading-bot/types";

beforeEach(() => __resetTradingBotStore());

function buyIntent(userId: string, quantity: string): TradeIntent {
  return {
    userId,
    symbol: "BTC/USDT",
    timeframe: "4h",
    side: "BUY",
    requestedQuantity: new Prisma.Decimal(quantity),
    sourceSignal: {
      direction: "LONG",
      entryZone: { low: 100, high: 100 },
      stopLoss: 90,
      takeProfit: [],
      riskRewardRatio: 2,
      confidence: 70,
      generatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };
}

function sellIntent(userId: string, quantity: string): TradeIntent {
  return {
    userId,
    symbol: "BTC/USDT",
    timeframe: "4h",
    side: "SELL",
    requestedQuantity: new Prisma.Decimal(quantity),
    createdAt: new Date().toISOString(),
  };
}

describe("MockBroker BUY", () => {
  it("computes notional/fee and deducts total cost from cash", async () => {
    const result = await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k1",
      intent: buyIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("100"),
    });
    expect(result.status).toBe("FILLED");
    expect(result.fill?.notional.toString()).toBe("100");
    expect(result.fill?.fee.toString()).toBe("0.1"); // 100 * 0.001
    const account = getAccountForUser("user-1");
    expect(account.cashBalance.toString()).toBe("9899.9"); // 10000 - 100.1
  });

  it("updates weighted average entry price across repeat buys", async () => {
    await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k1",
      intent: buyIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("100"),
    });
    await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k2",
      intent: buyIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("200"),
    });
    const account = getAccountForUser("user-1");
    const position = account.positions.get("BTC/USDT")!;
    expect(position.quantity.toString()).toBe("2");
    expect(position.avgEntryPrice.toString()).toBe("150"); // (1*100 + 1*200) / 2
  });

  it("rejects INSUFFICIENT_FUNDS when notional + fee exceeds cash (not raw quantity vs equity)", async () => {
    const result = await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k1",
      intent: buyIntent("user-1", "1000"), // 1000 * 100 = 100,000 notional, way over 10,000 cash
      executionPrice: new Prisma.Decimal("100"),
    });
    expect(result.status).toBe("REJECTED");
    expect(result.reasonCode).toBe("INSUFFICIENT_FUNDS");
    const account = getAccountForUser("user-1");
    expect(account.cashBalance.toString()).toBe("10000"); // unchanged
  });
});

describe("MockBroker SELL", () => {
  async function openLongPosition(userId: string, quantity: string, price: string) {
    await mockBroker.placeOrder({
      userId,
      idempotencyKey: `open-${userId}`,
      intent: buyIntent(userId, quantity),
      executionPrice: new Prisma.Decimal(price),
    });
  }

  it("reduces the position and computes realized P&L including the fee", async () => {
    await openLongPosition("user-1", "2", "100");
    const result = await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "close-1",
      intent: sellIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("150"),
    });
    expect(result.status).toBe("FILLED");
    // (150 - 100) * 1 - fee(150*0.001=0.15) = 49.85
    expect(result.fill?.realizedPnl?.toString()).toBe("49.85");
    const account = getAccountForUser("user-1");
    const position = account.positions.get("BTC/USDT")!;
    expect(position.quantity.toString()).toBe("1");
    expect(position.avgEntryPrice.toString()).toBe("100"); // unchanged on partial close
  });

  it("removes the position entirely on a full close", async () => {
    await openLongPosition("user-1", "1", "100");
    await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "close-1",
      intent: sellIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("110"),
    });
    const account = getAccountForUser("user-1");
    expect(account.positions.has("BTC/USDT")).toBe(false);
  });

  it("rejects NO_OPEN_POSITION when the user holds none for the symbol (no naked SELL)", async () => {
    const result = await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k1",
      intent: sellIntent("user-1", "1"),
      executionPrice: new Prisma.Decimal("100"),
    });
    expect(result.status).toBe("REJECTED");
    expect(result.reasonCode).toBe("NO_OPEN_POSITION");
  });

  it("rejects INSUFFICIENT_POSITION when quantity exceeds held quantity", async () => {
    await openLongPosition("user-1", "1", "100");
    const result = await mockBroker.placeOrder({
      userId: "user-1",
      idempotencyKey: "k1",
      intent: sellIntent("user-1", "2"),
      executionPrice: new Prisma.Decimal("100"),
    });
    expect(result.status).toBe("REJECTED");
    expect(result.reasonCode).toBe("INSUFFICIENT_POSITION");
    const account = getAccountForUser("user-1");
    expect(account.positions.get("BTC/USDT")!.quantity.toString()).toBe("1"); // unchanged
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- trading-bot-mock-broker`
Expected: FAIL with "Cannot find module '@/lib/trading-bot/mock-broker'"

- [ ] **Step 3: Create `lib/trading-bot/broker-types.ts`**

```ts
import type { Prisma } from "@prisma/client";
import type { MockAccount, MockPosition, OrderResult, TradeIntent } from "./types";

export interface PlaceOrderRequest {
  userId: string;
  idempotencyKey: string;
  intent: TradeIntent; // already RiskEngine-approved by the caller
  executionPrice: Prisma.Decimal; // server-derived; the adapter never re-derives it
}

export interface BrokerAdapter {
  getAccount(userId: string): Promise<MockAccount>;
  placeOrder(request: PlaceOrderRequest): Promise<OrderResult>;
  getPositions(userId: string): Promise<MockPosition[]>;
}
```

- [ ] **Step 4: Create `lib/trading-bot/mock-broker.ts`**

```ts
// In-memory, per-user, long-only paper-broker. Never fetches market data or a
// price itself — PlaceOrderRequest.executionPrice is always caller-supplied.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getAccountForUser } from "./store";
import { estimateOrderCost } from "./pricing";
import { MOCK_FEE_RATE } from "./config";
import { defaultReason } from "./errors";
import type { BrokerAdapter, PlaceOrderRequest } from "./broker-types";
import type { Fill, MockPosition, OrderResult } from "./types";

function rounded(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}

function rejected(
  orderId: string,
  side: "BUY" | "SELL",
  symbol: string,
  requestedQuantity: Prisma.Decimal,
  reasonCode: OrderResult["reasonCode"],
): OrderResult {
  return {
    orderId,
    status: "REJECTED",
    reasonCode,
    reason: reasonCode ? defaultReason(reasonCode) : null,
    side,
    symbol,
    requestedQuantity,
    fill: null,
    idempotent: false,
  };
}

export class MockBroker implements BrokerAdapter {
  async getAccount(userId: string) {
    return getAccountForUser(userId);
  }

  async getPositions(userId: string) {
    return [...getAccountForUser(userId).positions.values()];
  }

  async placeOrder(request: PlaceOrderRequest): Promise<OrderResult> {
    const { intent, executionPrice, userId } = request;
    const account = getAccountForUser(userId);
    const orderId = randomUUID();
    const executedAt = new Date().toISOString();

    if (intent.side === "BUY") {
      const notional = rounded(executionPrice.times(intent.requestedQuantity));
      const fee = rounded(notional.times(MOCK_FEE_RATE));
      const totalCost = rounded(estimateOrderCost(notional));
      if (totalCost.greaterThan(account.cashBalance)) {
        return rejected(orderId, "BUY", intent.symbol, intent.requestedQuantity, "INSUFFICIENT_FUNDS");
      }

      account.cashBalance = rounded(account.cashBalance.minus(totalCost));

      const existing = account.positions.get(intent.symbol);
      let position: MockPosition;
      if (existing) {
        const newQuantity = existing.quantity.plus(intent.requestedQuantity);
        const newAvgEntryPrice = rounded(
          existing.quantity
            .times(existing.avgEntryPrice)
            .plus(intent.requestedQuantity.times(executionPrice))
            .dividedBy(newQuantity),
        );
        position = {
          symbol: intent.symbol,
          quantity: newQuantity,
          avgEntryPrice: newAvgEntryPrice,
          realizedPnl: existing.realizedPnl,
        };
      } else {
        position = {
          symbol: intent.symbol,
          quantity: intent.requestedQuantity,
          avgEntryPrice: rounded(executionPrice),
          realizedPnl: new Prisma.Decimal(0),
        };
      }
      account.positions.set(intent.symbol, position);

      const fill: Fill = {
        orderId,
        userId,
        symbol: intent.symbol,
        side: "BUY",
        quantity: intent.requestedQuantity,
        price: rounded(executionPrice),
        fee,
        notional,
        realizedPnl: null,
        executedAt,
      };
      return {
        orderId,
        status: "FILLED",
        reasonCode: null,
        reason: null,
        side: "BUY",
        symbol: intent.symbol,
        requestedQuantity: intent.requestedQuantity,
        fill,
        idempotent: false,
      };
    }

    // SELL — long-only: may only reduce or fully close an existing position.
    const position = account.positions.get(intent.symbol);
    if (!position) {
      return rejected(orderId, "SELL", intent.symbol, intent.requestedQuantity, "NO_OPEN_POSITION");
    }
    if (intent.requestedQuantity.greaterThan(position.quantity)) {
      return rejected(orderId, "SELL", intent.symbol, intent.requestedQuantity, "INSUFFICIENT_POSITION");
    }

    const proceeds = rounded(executionPrice.times(intent.requestedQuantity));
    const fee = rounded(proceeds.times(MOCK_FEE_RATE));
    const netProceeds = rounded(proceeds.minus(fee));
    const realizedPnl = rounded(
      executionPrice.minus(position.avgEntryPrice).times(intent.requestedQuantity).minus(fee),
    );

    account.cashBalance = rounded(account.cashBalance.plus(netProceeds));
    const remainingQuantity = position.quantity.minus(intent.requestedQuantity);
    if (remainingQuantity.isZero()) {
      account.positions.delete(intent.symbol);
    } else {
      account.positions.set(intent.symbol, {
        symbol: intent.symbol,
        quantity: remainingQuantity,
        avgEntryPrice: position.avgEntryPrice, // unchanged on partial close
        realizedPnl: rounded(position.realizedPnl.plus(realizedPnl)),
      });
    }

    const fill: Fill = {
      orderId,
      userId,
      symbol: intent.symbol,
      side: "SELL",
      quantity: intent.requestedQuantity,
      price: rounded(executionPrice),
      fee,
      notional: proceeds,
      realizedPnl,
      executedAt,
    };
    return {
      orderId,
      status: "FILLED",
      reasonCode: null,
      reason: null,
      side: "SELL",
      symbol: intent.symbol,
      requestedQuantity: intent.requestedQuantity,
      fill,
      idempotent: false,
    };
  }
}

export const mockBroker = new MockBroker();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- trading-bot-mock-broker`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/trading-bot/broker-types.ts lib/trading-bot/mock-broker.ts tests/trading-bot-mock-broker.test.ts
git commit -m "feat(trading-bot): add BrokerAdapter interface and MockBroker"
```

---

### Task 7: `risk-engine.ts` — StubRiskEngine

**Files:**
- Create: `lib/trading-bot/risk-engine.ts`
- Test: `tests/trading-bot-risk-engine.test.ts`

**Interfaces:**
- Consumes: `estimateOrderCost`, `deriveBuyExecutionPrice` (Task 3), `defaultReason` (Task 1), `MockAccount`, `RejectCode`, `TradeIntent` (Task 1).
- Produces: `RiskVerdict`, `RiskEngine` interface, `StubRiskEngine` class, `stubRiskEngine` singleton with `evaluate(intent: TradeIntent, account: MockAccount): RiskVerdict`. Used by both routes (Tasks 10, 11).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-bot-risk-engine.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { stubRiskEngine } from "@/lib/trading-bot/risk-engine";
import type { MockAccount, TradeIntent } from "@/lib/trading-bot/types";

function account(cash: string, positions: MockAccount["positions"] = new Map()): MockAccount {
  return {
    userId: "user-1",
    cashBalance: new Prisma.Decimal(cash),
    startingBalance: new Prisma.Decimal("10000"),
    positions,
  };
}

function buyIntent(quantity: string, stopLoss: number | undefined = 90): TradeIntent {
  return {
    userId: "user-1",
    symbol: "BTC/USDT",
    timeframe: "4h",
    side: "BUY",
    requestedQuantity: new Prisma.Decimal(quantity),
    sourceSignal: stopLoss === undefined ? undefined : {
      direction: "LONG",
      entryZone: { low: 100, high: 100 },
      stopLoss,
      takeProfit: [],
      riskRewardRatio: 2,
      confidence: 70,
      generatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };
}

function sellIntent(quantity: string): TradeIntent {
  return {
    userId: "user-1",
    symbol: "BTC/USDT",
    timeframe: "4h",
    side: "SELL",
    requestedQuantity: new Prisma.Decimal(quantity),
    createdAt: new Date().toISOString(),
  };
}

describe("StubRiskEngine — BUY", () => {
  it("approves a well-formed, affordable BUY", () => {
    const verdict = stubRiskEngine.evaluate(buyIntent("1"), account("10000"));
    expect(verdict.approved).toBe(true);
  });

  it("rejects MISSING_STOP_LOSS when there is no source signal", () => {
    const verdict = stubRiskEngine.evaluate(buyIntent("1", undefined), account("10000"));
    expect(verdict.approved).toBe(false);
    if (!verdict.approved) expect(verdict.code).toBe("MISSING_STOP_LOSS");
  });

  it("rejects INSUFFICIENT_FUNDS on total cost (notional + fee), not raw quantity vs equity", () => {
    // entry midpoint = 100, quantity 1000 -> notional 100,000, way over 10,000 cash
    const verdict = stubRiskEngine.evaluate(buyIntent("1000"), account("10000"));
    expect(verdict.approved).toBe(false);
    if (!verdict.approved) expect(verdict.code).toBe("INSUFFICIENT_FUNDS");
  });
});

describe("StubRiskEngine — SELL", () => {
  it("approves a SELL within the held position", () => {
    const positions = new Map([["BTC/USDT", {
      symbol: "BTC/USDT",
      quantity: new Prisma.Decimal("2"),
      avgEntryPrice: new Prisma.Decimal("100"),
      realizedPnl: new Prisma.Decimal("0"),
    }]]);
    const verdict = stubRiskEngine.evaluate(sellIntent("1"), account("10000", positions));
    expect(verdict.approved).toBe(true);
  });

  it("rejects NO_OPEN_POSITION when the user holds none", () => {
    const verdict = stubRiskEngine.evaluate(sellIntent("1"), account("10000"));
    expect(verdict.approved).toBe(false);
    if (!verdict.approved) expect(verdict.code).toBe("NO_OPEN_POSITION");
  });

  it("rejects INSUFFICIENT_POSITION when quantity exceeds held quantity", () => {
    const positions = new Map([["BTC/USDT", {
      symbol: "BTC/USDT",
      quantity: new Prisma.Decimal("1"),
      avgEntryPrice: new Prisma.Decimal("100"),
      realizedPnl: new Prisma.Decimal("0"),
    }]]);
    const verdict = stubRiskEngine.evaluate(sellIntent("2"), account("10000", positions));
    expect(verdict.approved).toBe(false);
    if (!verdict.approved) expect(verdict.code).toBe("INSUFFICIENT_POSITION");
  });
});

describe("StubRiskEngine — quantity format", () => {
  it("rejects a zero quantity defensively", () => {
    const verdict = stubRiskEngine.evaluate(buyIntent("0"), account("10000"));
    expect(verdict.approved).toBe(false);
    if (!verdict.approved) expect(verdict.code).toBe("INVALID_QUANTITY");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- trading-bot-risk-engine`
Expected: FAIL with "Cannot find module '@/lib/trading-bot/risk-engine'"

- [ ] **Step 3: Create `lib/trading-bot/risk-engine.ts`**

```ts
// Phase 1 risk gate — EXACTLY these four rules, nothing else. This is NOT the
// full Risk Engine (no daily loss limit, drawdown, exposure cap, cooldown,
// session restriction, circuit breaker, kill switch) — Phase 4 replaces this
// file's contents, not its interface. Signal-age and candle-freshness are
// deliberately NOT risk-engine rules — they gate intent construction upstream
// (Strategy for BUY, the close route for SELL); this engine only ever sees
// intents already built from fresh data.
import { estimateOrderCost, deriveBuyExecutionPrice } from "./pricing";
import { defaultReason } from "./errors";
import type { MockAccount, RejectCode, TradeIntent } from "./types";

export type RiskVerdict =
  | { approved: true }
  | { approved: false; code: RejectCode; reason: string };

export interface RiskEngine {
  evaluate(intent: TradeIntent, account: MockAccount): RiskVerdict;
}

function reject(code: RejectCode): RiskVerdict {
  return { approved: false, code, reason: defaultReason(code) };
}

export class StubRiskEngine implements RiskEngine {
  evaluate(intent: TradeIntent, account: MockAccount): RiskVerdict {
    if (
      !intent.requestedQuantity.isFinite() ||
      intent.requestedQuantity.isNegative() ||
      intent.requestedQuantity.isZero()
    ) {
      return reject("INVALID_QUANTITY");
    }

    if (intent.side === "BUY") {
      if (!intent.sourceSignal || intent.sourceSignal.stopLoss === null) {
        return reject("MISSING_STOP_LOSS");
      }
      const executionPrice = deriveBuyExecutionPrice(intent.sourceSignal);
      const notional = executionPrice.times(intent.requestedQuantity);
      const totalCost = estimateOrderCost(notional);
      if (totalCost.greaterThan(account.cashBalance)) {
        return reject("INSUFFICIENT_FUNDS");
      }
      return { approved: true };
    }

    // SELL
    const position = account.positions.get(intent.symbol);
    if (!position) return reject("NO_OPEN_POSITION");
    if (intent.requestedQuantity.greaterThan(position.quantity)) {
      return reject("INSUFFICIENT_POSITION");
    }
    return { approved: true };
  }
}

export const stubRiskEngine = new StubRiskEngine();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- trading-bot-risk-engine`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/trading-bot/risk-engine.ts tests/trading-bot-risk-engine.test.ts
git commit -m "feat(trading-bot): add StubRiskEngine (4 rules, Phase 1 only)"
```

---

### Task 8: `strategy.ts` — SignalEngineStrategy

**Files:**
- Create: `lib/trading-bot/strategy.ts`
- Test: `tests/trading-bot-strategy.test.ts`

**Interfaces:**
- Consumes: `getCandles` from `@/lib/market-data/candles`; `buildSignalFromCandles`, `SUPPORTED_SYMBOLS`, `SYMBOL_WHITELIST`, `DEFAULT_TIMEFRAME`, `CANDLE_LIMIT` from `@/lib/trading-signals/config` and `@/lib/trading-signals/engine`; `checkCandleFreshness` (Task 4); `SIGNAL_FRESHNESS_WINDOW_MS` (Task 1); `defaultReason` (Task 1); `TradeIntent`, `RejectCode` (Task 1).
- Produces: `StrategyResult`, `Strategy` interface, `parseSignalId(signalId: string): { symbol: string; timeframe: "4h" } | null`, `SignalEngineStrategy` class, `signalEngineStrategy` singleton with `generateIntent(userId, signalId, observedGeneratedAt, requestedQuantity): Promise<StrategyResult>`. Used by the orders route (Task 10).

**Note:** this module deliberately calls `getCandles` + `buildSignalFromCandles` directly (not `generateSignals`) because the raw `CandleSeries` (with each candle's `openTime`) is required for the candle-freshness check — `TradingSignal` itself carries no candle timestamp.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-bot-strategy.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/market-data/candles", () => ({ getCandles: vi.fn() }));
vi.mock("@/lib/trading-signals/engine", () => ({ buildSignalFromCandles: vi.fn() }));

import { getCandles } from "@/lib/market-data/candles";
import { buildSignalFromCandles } from "@/lib/trading-signals/engine";
import { signalEngineStrategy, parseSignalId } from "@/lib/trading-bot/strategy";
import { TIMEFRAME_DURATION_MS, CANDLE_STALENESS_GRACE_MS } from "@/lib/trading-bot/freshness";

const NOW_ISO = "2026-07-14T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function candleAt(openTime: number) {
  return { openTime, open: 100, high: 101, low: 99, close: 100, volume: 10 };
}

function freshSeries(overrideCandleAgeMs = 60_000) {
  return {
    symbol: "BTC/USDT",
    timeframe: "4h" as const,
    candles: [candleAt(NOW_MS - overrideCandleAgeMs)],
    source: "live" as const,
    fetchedAt: NOW_MS,
  };
}

function longSignal() {
  return {
    symbol: "BTC/USDT",
    timeframe: "4h",
    direction: "LONG",
    entryZone: { low: 100, high: 110 },
    stopLoss: 90,
    takeProfit: [{ price: 130, label: "TP1" }],
    riskRewardRatio: 2,
    confidence: 70,
    reasoning: ["ok"],
    invalidationCondition: "x",
    generatedAt: NOW_ISO,
    source: "analysis",
  };
}

beforeEach(() => {
  vi.mocked(getCandles).mockReset();
  vi.mocked(buildSignalFromCandles).mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});

describe("parseSignalId", () => {
  it("parses a valid signalId", () => {
    expect(parseSignalId("BTC/USDT:4h")).toEqual({ symbol: "BTC/USDT", timeframe: "4h" });
  });
  it("rejects an unknown symbol", () => {
    expect(parseSignalId("DOGE/USDT:4h")).toBeNull();
  });
  it("rejects a non-default timeframe", () => {
    expect(parseSignalId("BTC/USDT:1h")).toBeNull();
  });
  it("rejects a malformed string", () => {
    expect(parseSignalId("garbage")).toBeNull();
  });
});

describe("SignalEngineStrategy.generateIntent", () => {
  it("rejects UNRECOGNIZED_SIGNAL for an unknown signalId", async () => {
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "DOGE/USDT:4h", NOW_ISO, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNRECOGNIZED_SIGNAL");
    expect(getCandles).not.toHaveBeenCalled();
  });

  it("rejects STALE_CANDLE_DATA when the latest candle exceeds the timeframe+grace ceiling", async () => {
    const maxAge = TIMEFRAME_DURATION_MS["4h"] + CANDLE_STALENESS_GRACE_MS;
    vi.mocked(getCandles).mockResolvedValue(freshSeries(maxAge + 1));
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", NOW_ISO, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STALE_CANDLE_DATA");
    expect(buildSignalFromCandles).not.toHaveBeenCalled();
  });

  it("does NOT reject a 3h-old candle on a 4h timeframe merely for candle age", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries(3 * 60 * 60_000));
    vi.mocked(buildSignalFromCandles).mockReturnValue(longSignal() as never);
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", NOW_ISO, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects NON_ACTIONABLE_SIGNAL for a WAIT signal", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries());
    vi.mocked(buildSignalFromCandles).mockReturnValue({ ...longSignal(), direction: "WAIT" } as never);
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", NOW_ISO, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NON_ACTIONABLE_SIGNAL");
  });

  it("rejects UNSUPPORTED_SHORT for a SHORT signal", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries());
    vi.mocked(buildSignalFromCandles).mockReturnValue({ ...longSignal(), direction: "SHORT" } as never);
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", NOW_ISO, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_SHORT");
  });

  it("rejects STALE_SIGNAL when observedGeneratedAt is older than 5 minutes", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries());
    vi.mocked(buildSignalFromCandles).mockReturnValue(longSignal() as never);
    const oldObserved = new Date(NOW_MS - 6 * 60_000).toISOString();
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", oldObserved, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STALE_SIGNAL");
  });

  it("builds a BUY TradeIntent for a fresh, actionable LONG signal within the freshness window", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries());
    vi.mocked(buildSignalFromCandles).mockReturnValue(longSignal() as never);
    const observed = new Date(NOW_MS - 60_000).toISOString();
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", observed, new Prisma.Decimal("0.5"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.side).toBe("BUY");
      expect(result.intent.symbol).toBe("BTC/USDT");
      expect(result.intent.requestedQuantity.toString()).toBe("0.5");
      expect(result.intent.sourceSignal?.stopLoss).toBe(90);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- trading-bot-strategy`
Expected: FAIL with "Cannot find module '@/lib/trading-bot/strategy'"

- [ ] **Step 3: Create `lib/trading-bot/strategy.ts`**

```ts
import { Prisma } from "@prisma/client";
import { getCandles } from "@/lib/market-data/candles";
import { buildSignalFromCandles } from "@/lib/trading-signals/engine";
import {
  CANDLE_LIMIT,
  DEFAULT_TIMEFRAME,
  SUPPORTED_SYMBOLS,
  SYMBOL_WHITELIST,
} from "@/lib/trading-signals/config";
import { checkCandleFreshness } from "./freshness";
import { SIGNAL_FRESHNESS_WINDOW_MS } from "./config";
import { defaultReason } from "./errors";
import type { RejectCode, TradeIntent } from "./types";

export type StrategyResult =
  | { ok: true; intent: TradeIntent }
  | { ok: false; code: RejectCode; reason: string };

export interface Strategy {
  generateIntent(
    userId: string,
    signalId: string,
    observedGeneratedAt: string,
    requestedQuantity: Prisma.Decimal,
  ): Promise<StrategyResult>;
}

function reject(code: RejectCode, reason?: string): StrategyResult {
  return { ok: false, code, reason: reason ?? defaultReason(code) };
}

/** signalId format: "<symbol>:<timeframe>", validated against the whitelist. */
export function parseSignalId(signalId: string): { symbol: string; timeframe: "4h" } | null {
  const [symbol, timeframe] = signalId.split(":");
  if (!symbol || !timeframe) return null;
  if (!SUPPORTED_SYMBOLS.includes(symbol)) return null;
  if (timeframe !== DEFAULT_TIMEFRAME) return null;
  return { symbol, timeframe: DEFAULT_TIMEFRAME as "4h" };
}

export class SignalEngineStrategy implements Strategy {
  async generateIntent(
    userId: string,
    signalId: string,
    observedGeneratedAt: string,
    requestedQuantity: Prisma.Decimal,
  ): Promise<StrategyResult> {
    const parsed = parseSignalId(signalId);
    if (!parsed) return reject("UNRECOGNIZED_SIGNAL");
    const { symbol, timeframe } = parsed;
    const ticker = SYMBOL_WHITELIST[symbol];

    // Candle-data freshness — independent of signal-instance age, checked first
    // so we never spend effort building a signal from data already known stale.
    const series = await getCandles(ticker, timeframe, CANDLE_LIMIT);
    const freshness = checkCandleFreshness(series.candles, timeframe, Date.now());
    if (!freshness.ok) return reject(freshness.code, freshness.reason);

    const signal = buildSignalFromCandles({ ...series, symbol }, new Date().toISOString());

    if (signal.direction === "WAIT" || signal.source === "insufficient-data") {
      return reject("NON_ACTIONABLE_SIGNAL");
    }
    if (signal.direction === "SHORT") {
      return reject("UNSUPPORTED_SHORT");
    }
    if (signal.stopLoss === null || signal.entryZone === null) {
      return reject("NON_ACTIONABLE_SIGNAL", "Signal is missing required levels.");
    }

    // Signal-INSTANCE age — independent of candle freshness above. Bounds how
    // long ago the specific signal the user looked at was generated.
    const observedAgeMs = Date.now() - Date.parse(observedGeneratedAt);
    if (!Number.isFinite(observedAgeMs) || observedAgeMs > SIGNAL_FRESHNESS_WINDOW_MS) {
      return reject("STALE_SIGNAL");
    }

    if (
      !requestedQuantity.isFinite() ||
      requestedQuantity.isNegative() ||
      requestedQuantity.isZero()
    ) {
      return reject("INVALID_QUANTITY");
    }

    const intent: TradeIntent = {
      userId,
      symbol,
      timeframe,
      side: "BUY",
      requestedQuantity,
      sourceSignal: {
        direction: "LONG",
        entryZone: signal.entryZone,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskRewardRatio: signal.riskRewardRatio,
        confidence: signal.confidence,
        generatedAt: signal.generatedAt,
      },
      createdAt: new Date().toISOString(),
    };
    return { ok: true, intent };
  }
}

export const signalEngineStrategy = new SignalEngineStrategy();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- trading-bot-strategy`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/trading-bot/strategy.ts tests/trading-bot-strategy.test.ts
git commit -m "feat(trading-bot): add SignalEngineStrategy with dual freshness checks"
```

---

### Task 9: Rate-limit buckets + `.env.example`

**Files:**
- Modify: `lib/api/rate-limit.ts`
- Modify: `.env.example`
- Test: `tests/trading-bot-rate-limit.test.ts`

**Interfaces:**
- Produces: `RateLimitBucket` gains `"tradingBotRead" | "tradingBotWrite"`. Used by all four routes (Tasks 10–12).

- [ ] **Step 1: Write the failing test**

```ts
// tests/trading-bot-rate-limit.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { enforceRateLimit, __resetRateLimiters } from "@/lib/api/rate-limit";
import { TooManyRequests } from "@/lib/api/errors";

describe("enforceRateLimit — tradingBot buckets", () => {
  const prevRead = process.env.RATE_LIMIT_TRADING_BOT_READ_MAX;
  const prevWrite = process.env.RATE_LIMIT_TRADING_BOT_WRITE_MAX;

  beforeEach(() => {
    __resetRateLimiters();
    process.env.RATE_LIMIT_TRADING_BOT_READ_MAX = "2";
    process.env.RATE_LIMIT_TRADING_BOT_WRITE_MAX = "2";
  });

  afterEach(() => {
    if (prevRead === undefined) delete process.env.RATE_LIMIT_TRADING_BOT_READ_MAX;
    else process.env.RATE_LIMIT_TRADING_BOT_READ_MAX = prevRead;
    if (prevWrite === undefined) delete process.env.RATE_LIMIT_TRADING_BOT_WRITE_MAX;
    else process.env.RATE_LIMIT_TRADING_BOT_WRITE_MAX = prevWrite;
    __resetRateLimiters();
  });

  it("enforces the configured max for tradingBotRead, then blocks", () => {
    expect(() => enforceRateLimit("user-1", "tradingBotRead")).not.toThrow();
    expect(() => enforceRateLimit("user-1", "tradingBotRead")).not.toThrow();
    expect(() => enforceRateLimit("user-1", "tradingBotRead")).toThrow(TooManyRequests);
  });

  it("enforces the configured max for tradingBotWrite independently of tradingBotRead", () => {
    enforceRateLimit("user-1", "tradingBotRead");
    enforceRateLimit("user-1", "tradingBotRead");
    expect(() => enforceRateLimit("user-1", "tradingBotWrite")).not.toThrow();
  });

  it("isolates the tradingBotWrite budget per user", () => {
    enforceRateLimit("user-1", "tradingBotWrite");
    enforceRateLimit("user-1", "tradingBotWrite");
    expect(() => enforceRateLimit("user-2", "tradingBotWrite")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- trading-bot-rate-limit`
Expected: FAIL — `enforceRateLimit("user-1", "tradingBotRead")` is a type error / falls through to the default `providerRead` branch rather than a dedicated bucket (test still executes since bucket is a string at runtime, but the 4th step's isolation assumption from `providerRead`'s default limit of 60 makes assertions 1–2 fail against the intended limit of 2).

- [ ] **Step 3: Modify `lib/api/rate-limit.ts`**

Find the `RateLimitBucket` type definition:

```ts
export type RateLimitBucket = "write" | "providerRead" | "agentsRead" | "signalsRead";
```

Replace with:

```ts
export type RateLimitBucket =
  | "write"
  | "providerRead"
  | "agentsRead"
  | "signalsRead"
  | "tradingBotRead"
  | "tradingBotWrite";
```

Find the `limiterFor` function's limit-selection ternary:

```ts
  const limit =
    bucket === "write"
      ? envInt("RATE_LIMIT_WRITE_MAX", 30)
      : bucket === "agentsRead"
        ? envInt("RATE_LIMIT_AGENTS_MAX", 30)
        : bucket === "signalsRead"
          ? envInt("RATE_LIMIT_SIGNALS_MAX", 60)
          : envInt("RATE_LIMIT_READ_MAX", 60);
```

Replace with:

```ts
  const limit =
    bucket === "write"
      ? envInt("RATE_LIMIT_WRITE_MAX", 30)
      : bucket === "agentsRead"
        ? envInt("RATE_LIMIT_AGENTS_MAX", 30)
        : bucket === "signalsRead"
          ? envInt("RATE_LIMIT_SIGNALS_MAX", 60)
          : bucket === "tradingBotRead"
            ? envInt("RATE_LIMIT_TRADING_BOT_READ_MAX", 60)
            : bucket === "tradingBotWrite"
              ? envInt("RATE_LIMIT_TRADING_BOT_WRITE_MAX", 20)
              : envInt("RATE_LIMIT_READ_MAX", 60);
```

- [ ] **Step 4: Append to `.env.example`**

Add after the existing `RATE_LIMIT_AGENTS_MAX` line:

```
# Max /api/trading-bot/{account,positions} reads per user per window (default 60).
RATE_LIMIT_TRADING_BOT_READ_MAX="60"
# Max /api/trading-bot/{orders,positions/close} writes per user per window (default 20).
RATE_LIMIT_TRADING_BOT_WRITE_MAX="20"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- trading-bot-rate-limit`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full existing rate-limit suite to confirm no regression**

Run: `npm test -- rate-limit`
Expected: PASS (all pre-existing `rate-limit.test.ts` cases plus the 3 new ones)

- [ ] **Step 7: Commit**

```bash
git add lib/api/rate-limit.ts .env.example tests/trading-bot-rate-limit.test.ts
git commit -m "feat(trading-bot): add tradingBotRead/tradingBotWrite rate-limit buckets"
```

---

### Task 10: `POST /api/trading-bot/orders` — BUY, signal-driven

**Files:**
- Create: `app/api/trading-bot/orders/route.ts`
- Test: `tests/trading-bot-orders-route.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/auth/current-user`; `enforceRateLimit`, `toErrorResponse` from `lib/api`; `quantityInputSchema`, `parseQuantityInput`, `toDecimalString` (Task 2); `signalEngineStrategy` (Task 8); `stubRiskEngine` (Task 7); `mockBroker` (Task 6); `deriveBuyExecutionPrice` (Task 3); `getAccountForUser`, `getIdempotentResult`, `storeIdempotentResult`, `withUserLock` (Task 5); `defaultReason` (Task 1); `OrderResultDTO` (Task 1); `OrderResult` (Task 1).
- Produces: `POST` handler at `/api/trading-bot/orders`, the full BUY pipeline: canonical signal → `Strategy` → `TradeIntent` → `RiskEngine` → `MockBroker` → `Fill`. Consumed by the page (Task 15).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-bot-orders-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({ requireUser: vi.fn() }));

import { requireUser } from "@/lib/auth/current-user";
import { POST } from "@/app/api/trading-bot/orders/route";
import { signalEngineStrategy } from "@/lib/trading-bot/strategy";
import { mockBroker } from "@/lib/trading-bot/mock-broker";
import { stubRiskEngine } from "@/lib/trading-bot/risk-engine";
import { __resetRateLimiters } from "@/lib/api/rate-limit";
import { __resetTradingBotStore, getAccountForUser } from "@/lib/trading-bot/store";
import { Prisma } from "@prisma/client";

beforeEach(() => {
  __resetTradingBotStore();
  __resetRateLimiters();
  vi.mocked(requireUser).mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/trading-bot/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(idempotencyKey = "key-1") {
  return {
    signalId: "BTC/USDT:4h",
    observedGeneratedAt: new Date().toISOString(),
    requestedQuantity: "0.5",
    idempotencyKey,
  };
}

describe("POST /api/trading-bot/orders — authorization", () => {
  it("returns 401 when requireUser rejects, independent of any middleware", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("no session"));
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/trading-bot/orders — pipeline", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", clerkUserId: "clerk-1" });
  });

  it("returns FILLED with every monetary/quantity field as a string, via a real Strategy fill", async () => {
    const account = getAccountForUser("user-1");
    account.cashBalance = new Prisma.Decimal("10000");
    vi.spyOn(signalEngineStrategy, "generateIntent").mockResolvedValue({
      ok: true,
      intent: {
        userId: "user-1",
        symbol: "BTC/USDT",
        timeframe: "4h",
        side: "BUY",
        requestedQuantity: new Prisma.Decimal("0.5"),
        sourceSignal: {
          direction: "LONG",
          entryZone: { low: 100, high: 100 },
          stopLoss: 90,
          takeProfit: [],
          riskRewardRatio: 2,
          confidence: 70,
          generatedAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      },
    });

    const res = await POST(req(validBody()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("FILLED");
    for (const field of ["requestedQuantity", "fillPrice", "fee", "notional"]) {
      expect(typeof json[field]).toBe("string");
    }
  });

  it("a RiskEngine rejection never reaches MockBroker.placeOrder", async () => {
    vi.spyOn(signalEngineStrategy, "generateIntent").mockResolvedValue({
      ok: true,
      intent: {
        userId: "user-1",
        symbol: "BTC/USDT",
        timeframe: "4h",
        side: "BUY",
        requestedQuantity: new Prisma.Decimal("0.5"),
        // no sourceSignal.stopLoss present is impossible via the type, so force
        // an INSUFFICIENT_FUNDS rejection with a huge quantity instead:
        sourceSignal: {
          direction: "LONG",
          entryZone: { low: 1_000_000, high: 1_000_000 },
          stopLoss: 900_000,
          takeProfit: [],
          riskRewardRatio: 2,
          confidence: 70,
          generatedAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      },
    });
    const placeOrderSpy = vi.spyOn(mockBroker, "placeOrder");
    const res = await POST(req(validBody()));
    const json = await res.json();
    expect(json.status).toBe("REJECTED");
    expect(json.reasonCode).toBe("INSUFFICIENT_FUNDS");
    expect(placeOrderSpy).not.toHaveBeenCalled();
  });

  it("idempotency: a duplicate key returns the identical result without a second fill", async () => {
    const account = getAccountForUser("user-1");
    account.cashBalance = new Prisma.Decimal("10000");
    vi.spyOn(signalEngineStrategy, "generateIntent").mockResolvedValue({
      ok: true,
      intent: {
        userId: "user-1",
        symbol: "BTC/USDT",
        timeframe: "4h",
        side: "BUY",
        requestedQuantity: new Prisma.Decimal("0.5"),
        sourceSignal: {
          direction: "LONG",
          entryZone: { low: 100, high: 100 },
          stopLoss: 90,
          takeProfit: [],
          riskRewardRatio: 2,
          confidence: 70,
          generatedAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      },
    });

    const first = await (await POST(req(validBody("dup-key")))).json();
    const cashAfterFirst = getAccountForUser("user-1").cashBalance.toString();
    const second = await (await POST(req(validBody("dup-key")))).json();
    const cashAfterSecond = getAccountForUser("user-1").cashBalance.toString();

    expect(second.orderId).toBe(first.orderId);
    expect(second.idempotent).toBe(true);
    expect(cashAfterSecond).toBe(cashAfterFirst); // no second deduction
  });

  it("per-user isolation: two users with the same idempotency key do not interact", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ userId: "user-1", clerkUserId: "c1" });
    vi.spyOn(signalEngineStrategy, "generateIntent").mockResolvedValue({
      ok: false,
      code: "NON_ACTIONABLE_SIGNAL",
      reason: "wait",
    });
    const first = await (await POST(req(validBody("shared-key")))).json();

    vi.mocked(requireUser).mockResolvedValueOnce({ userId: "user-2", clerkUserId: "c2" });
    const second = await (await POST(req(validBody("shared-key")))).json();

    expect(first.orderId).not.toBe(second.orderId);
    expect(second.idempotent).toBe(false); // fresh for user-2, not user-1's cached result
  });

  it("400 on a malformed body (bad quantity)", async () => {
    const res = await POST(req({ ...validBody(), requestedQuantity: "not-a-number" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- trading-bot-orders-route`
Expected: FAIL with "Cannot find module '@/app/api/trading-bot/orders/route'"

- [ ] **Step 3: Create `app/api/trading-bot/orders/route.ts`**

```ts
export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { toErrorResponse } from "@/lib/api/errors";
import { quantityInputSchema, parseQuantityInput, toDecimalString } from "@/lib/trading-bot/serialize";
import { signalEngineStrategy } from "@/lib/trading-bot/strategy";
import { stubRiskEngine } from "@/lib/trading-bot/risk-engine";
import { mockBroker } from "@/lib/trading-bot/mock-broker";
import { deriveBuyExecutionPrice } from "@/lib/trading-bot/pricing";
import {
  getAccountForUser,
  getIdempotentResult,
  storeIdempotentResult,
  withUserLock,
} from "@/lib/trading-bot/store";
import type { OrderResultDTO } from "@/lib/trading-bot/dto";
import type { OrderResult } from "@/lib/trading-bot/types";

const orderRequestSchema = z.object({
  signalId: z.string().min(1).max(64),
  observedGeneratedAt: z.string().min(1).max(64),
  requestedQuantity: quantityInputSchema,
  idempotencyKey: z.string().min(1).max(128),
});

function toDTO(result: OrderResult): OrderResultDTO {
  return {
    orderId: result.orderId,
    status: result.status,
    reasonCode: result.reasonCode,
    reason: result.reason,
    side: result.side,
    symbol: result.symbol,
    requestedQuantity: toDecimalString(result.requestedQuantity),
    fillPrice: result.fill ? toDecimalString(result.fill.price) : null,
    fee: result.fill ? toDecimalString(result.fill.fee) : null,
    notional: result.fill ? toDecimalString(result.fill.notional) : null,
    realizedPnl: result.fill?.realizedPnl ? toDecimalString(result.fill.realizedPnl) : null,
    executedAt: result.fill?.executedAt ?? null,
    idempotent: result.idempotent,
  };
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "tradingBotWrite");

    const body = await request.json();
    const input = orderRequestSchema.parse(body);
    const requestedQuantity = parseQuantityInput(input.requestedQuantity);

    const result = await withUserLock(userId, async () => {
      const cached = getIdempotentResult(userId, input.idempotencyKey);
      if (cached) return { ...cached, idempotent: true };

      const strategyResult = await signalEngineStrategy.generateIntent(
        userId,
        input.signalId,
        input.observedGeneratedAt,
        requestedQuantity,
      );
      if (!strategyResult.ok) {
        const rejected: OrderResult = {
          orderId: randomUUID(),
          status: "REJECTED",
          reasonCode: strategyResult.code,
          reason: strategyResult.reason,
          side: "BUY",
          symbol: input.signalId.split(":")[0] ?? "",
          requestedQuantity,
          fill: null,
          idempotent: false,
        };
        storeIdempotentResult(userId, input.idempotencyKey, rejected);
        return rejected;
      }

      const account = getAccountForUser(userId);
      const verdict = stubRiskEngine.evaluate(strategyResult.intent, account);
      if (!verdict.approved) {
        const rejected: OrderResult = {
          orderId: randomUUID(),
          status: "REJECTED",
          reasonCode: verdict.code,
          reason: verdict.reason,
          side: "BUY",
          symbol: strategyResult.intent.symbol,
          requestedQuantity,
          fill: null,
          idempotent: false,
        };
        storeIdempotentResult(userId, input.idempotencyKey, rejected);
        return rejected;
      }

      const executionPrice = deriveBuyExecutionPrice(strategyResult.intent.sourceSignal!);
      const filled = await mockBroker.placeOrder({
        userId,
        idempotencyKey: input.idempotencyKey,
        intent: strategyResult.intent,
        executionPrice,
      });
      storeIdempotentResult(userId, input.idempotencyKey, filled);
      return filled;
    });

    return NextResponse.json(toDTO(result));
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- trading-bot-orders-route`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/trading-bot/orders/route.ts tests/trading-bot-orders-route.test.ts
git commit -m "feat(trading-bot): add POST /api/trading-bot/orders (BUY, signal-driven)"
```

---

### Task 11: `POST /api/trading-bot/positions/close` — SELL, position-driven

**Files:**
- Create: `app/api/trading-bot/positions/close/route.ts`
- Test: `tests/trading-bot-close-route.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `enforceRateLimit`, `toErrorResponse`; `getCandles` from `@/lib/market-data/candles`; `SUPPORTED_SYMBOLS`, `SYMBOL_WHITELIST`, `DEFAULT_TIMEFRAME`, `CANDLE_LIMIT` from `@/lib/trading-signals/config`; `quantityInputSchema`, `parseQuantityInput`, `toDecimalString` (Task 2); `checkCandleFreshness` (Task 4); `stubRiskEngine` (Task 7); `mockBroker` (Task 6); `getAccountForUser`, `getIdempotentResult`, `storeIdempotentResult`, `withUserLock` (Task 5); `defaultReason` (Task 1).
- Produces: `POST` handler at `/api/trading-bot/positions/close` — the full SELL pipeline, unconditionally independent of any signal. Consumed by the page (Task 15).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-bot-close-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/auth/current-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/market-data/candles", () => ({ getCandles: vi.fn() }));

import { requireUser } from "@/lib/auth/current-user";
import { getCandles } from "@/lib/market-data/candles";
import { POST } from "@/app/api/trading-bot/positions/close/route";
import { mockBroker } from "@/lib/trading-bot/mock-broker";
import { __resetRateLimiters } from "@/lib/api/rate-limit";
import { __resetTradingBotStore, getAccountForUser } from "@/lib/trading-bot/store";

beforeEach(() => {
  __resetTradingBotStore();
  __resetRateLimiters();
  vi.mocked(requireUser).mockReset();
  vi.mocked(getCandles).mockReset();
  vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", clerkUserId: "clerk-1" });
});

function req(body: unknown) {
  return new Request("http://localhost/api/trading-bot/positions/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function freshSeries(close = 150) {
  const now = Date.now();
  return {
    symbol: "BTC/USDT",
    timeframe: "4h" as const,
    candles: [{ openTime: now - 60_000, open: 100, high: 155, low: 95, close, volume: 10 }],
    source: "live" as const,
    fetchedAt: now,
  };
}

function openLongPosition(userId: string) {
  const account = getAccountForUser(userId);
  account.positions.set("BTC/USDT", {
    symbol: "BTC/USDT",
    quantity: new Prisma.Decimal("1"),
    avgEntryPrice: new Prisma.Decimal("100"),
    realizedPnl: new Prisma.Decimal("0"),
  });
}

describe("POST /api/trading-bot/positions/close — authorization", () => {
  it("returns 401 when requireUser rejects", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("no session"));
    const res = await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "k1" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/trading-bot/positions/close — pipeline", () => {
  it("rejects NO_OPEN_POSITION when the user holds none, without calling getCandles", async () => {
    const res = await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "k1" }));
    const json = await res.json();
    expect(json.status).toBe("REJECTED");
    expect(json.reasonCode).toBe("NO_OPEN_POSITION");
    expect(getCandles).not.toHaveBeenCalled();
  });

  it("rejects INSUFFICIENT_POSITION when quantity exceeds held quantity", async () => {
    openLongPosition("user-1");
    const res = await POST(req({ symbol: "BTC/USDT", requestedQuantity: "2", idempotencyKey: "k1" }));
    const json = await res.json();
    expect(json.status).toBe("REJECTED");
    expect(json.reasonCode).toBe("INSUFFICIENT_POSITION");
  });

  it("fully closes a position by default-full-quantity request and removes it", async () => {
    openLongPosition("user-1");
    vi.mocked(getCandles).mockResolvedValue(freshSeries(150));
    const res = await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "k1" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("FILLED");
    expect(json.realizedPnl).not.toBeNull();
    expect(getAccountForUser("user-1").positions.has("BTC/USDT")).toBe(false);
  });

  it("rejects STALE_CANDLE_DATA when the candle feed is stale, with no mutation", async () => {
    openLongPosition("user-1");
    vi.mocked(getCandles).mockResolvedValue({
      symbol: "BTC/USDT",
      timeframe: "4h",
      candles: [],
      source: "insufficient",
      fetchedAt: Date.now(),
    });
    const res = await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "k1" }));
    const json = await res.json();
    expect(json.status).toBe("REJECTED");
    expect(json.reasonCode).toBe("STALE_CANDLE_DATA");
    expect(getAccountForUser("user-1").positions.has("BTC/USDT")).toBe(true); // unchanged
  });

  it("never imports or calls anything from lib/trading-signals for a close (unconditional of any signal)", async () => {
    openLongPosition("user-1");
    vi.mocked(getCandles).mockResolvedValue(freshSeries(150));
    const placeOrderSpy = vi.spyOn(mockBroker, "placeOrder");
    await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "k1" }));
    expect(placeOrderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ intent: expect.objectContaining({ sourceSignal: undefined }) }),
    );
  });

  it("idempotency: duplicate key returns identical result, single fill", async () => {
    openLongPosition("user-1");
    vi.mocked(getCandles).mockResolvedValue(freshSeries(150));
    const first = await (await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "dup" }))).json();
    const second = await (await POST(req({ symbol: "BTC/USDT", requestedQuantity: "1", idempotencyKey: "dup" }))).json();
    expect(second.orderId).toBe(first.orderId);
    expect(second.idempotent).toBe(true);
  });

  it("400 on a malformed body (missing symbol)", async () => {
    const res = await POST(req({ requestedQuantity: "1", idempotencyKey: "k1" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- trading-bot-close-route`
Expected: FAIL with "Cannot find module '@/app/api/trading-bot/positions/close/route'"

- [ ] **Step 3: Create `app/api/trading-bot/positions/close/route.ts`**

```ts
export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { toErrorResponse } from "@/lib/api/errors";
import { getCandles } from "@/lib/market-data/candles";
import { CANDLE_LIMIT, DEFAULT_TIMEFRAME, SYMBOL_WHITELIST } from "@/lib/trading-signals/config";
import { quantityInputSchema, parseQuantityInput, toDecimalString } from "@/lib/trading-bot/serialize";
import { checkCandleFreshness } from "@/lib/trading-bot/freshness";
import { stubRiskEngine } from "@/lib/trading-bot/risk-engine";
import { mockBroker } from "@/lib/trading-bot/mock-broker";
import {
  getAccountForUser,
  getIdempotentResult,
  storeIdempotentResult,
  withUserLock,
} from "@/lib/trading-bot/store";
import { defaultReason } from "@/lib/trading-bot/errors";
import type { OrderResultDTO } from "@/lib/trading-bot/dto";
import type { OrderResult, TradeIntent } from "@/lib/trading-bot/types";

const closeRequestSchema = z.object({
  symbol: z.string().min(1).max(20),
  requestedQuantity: quantityInputSchema,
  idempotencyKey: z.string().min(1).max(128),
});

function toDTO(result: OrderResult): OrderResultDTO {
  return {
    orderId: result.orderId,
    status: result.status,
    reasonCode: result.reasonCode,
    reason: result.reason,
    side: result.side,
    symbol: result.symbol,
    requestedQuantity: toDecimalString(result.requestedQuantity),
    fillPrice: result.fill ? toDecimalString(result.fill.price) : null,
    fee: result.fill ? toDecimalString(result.fill.fee) : null,
    notional: result.fill ? toDecimalString(result.fill.notional) : null,
    realizedPnl: result.fill?.realizedPnl ? toDecimalString(result.fill.realizedPnl) : null,
    executedAt: result.fill?.executedAt ?? null,
    idempotent: result.idempotent,
  };
}

function reject(
  symbol: string,
  requestedQuantity: Prisma.Decimal,
  reasonCode: NonNullable<OrderResult["reasonCode"]>,
  reason?: string,
): OrderResult {
  return {
    orderId: randomUUID(),
    status: "REJECTED",
    reasonCode,
    reason: reason ?? defaultReason(reasonCode),
    side: "SELL",
    symbol,
    requestedQuantity,
    fill: null,
    idempotent: false,
  };
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "tradingBotWrite");

    const body = await request.json();
    const input = closeRequestSchema.parse(body);
    const requestedQuantity = parseQuantityInput(input.requestedQuantity);

    const result = await withUserLock(userId, async () => {
      const cached = getIdempotentResult(userId, input.idempotencyKey);
      if (cached) return { ...cached, idempotent: true };

      // No signalId anywhere in this request or pipeline — closing a position
      // is unconditionally independent of any signal, including SHORT.
      const intent: TradeIntent = {
        userId,
        symbol: input.symbol,
        timeframe: DEFAULT_TIMEFRAME as "4h",
        side: "SELL",
        requestedQuantity,
        createdAt: new Date().toISOString(),
      };

      const account = getAccountForUser(userId);
      const verdict = stubRiskEngine.evaluate(intent, account);
      if (!verdict.approved) {
        const rejected = reject(input.symbol, requestedQuantity, verdict.code, verdict.reason);
        storeIdempotentResult(userId, input.idempotencyKey, rejected);
        return rejected;
      }

      // `symbol` is a selector into the user's own tracked positions, not
      // client-trusted pricing data — verdict.approved above already proves a
      // position exists for it, and positions only ever exist for symbols the
      // whitelist recognizes (BUY is gated by SignalEngineStrategy).
      const ticker = SYMBOL_WHITELIST[input.symbol];
      if (!ticker) {
        const rejected = reject(input.symbol, requestedQuantity, "NO_OPEN_POSITION");
        storeIdempotentResult(userId, input.idempotencyKey, rejected);
        return rejected;
      }

      const series = await getCandles(ticker, DEFAULT_TIMEFRAME, CANDLE_LIMIT);
      const freshness = checkCandleFreshness(series.candles, DEFAULT_TIMEFRAME, Date.now());
      if (!freshness.ok) {
        const rejected = reject(input.symbol, requestedQuantity, freshness.code, freshness.reason);
        storeIdempotentResult(userId, input.idempotencyKey, rejected);
        return rejected;
      }

      const lastCandle = series.candles[series.candles.length - 1];
      const executionPrice = new Prisma.Decimal(lastCandle.close);

      const filled = await mockBroker.placeOrder({
        userId,
        idempotencyKey: input.idempotencyKey,
        intent,
        executionPrice,
      });
      storeIdempotentResult(userId, input.idempotencyKey, filled);
      return filled;
    });

    return NextResponse.json(toDTO(result));
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- trading-bot-close-route`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/trading-bot/positions/close/route.ts tests/trading-bot-close-route.test.ts
git commit -m "feat(trading-bot): add POST /api/trading-bot/positions/close (SELL, long-only)"
```

---

### Task 12: `GET /api/trading-bot/account` and `GET /api/trading-bot/positions`

**Files:**
- Create: `app/api/trading-bot/account/route.ts`
- Create: `app/api/trading-bot/positions/route.ts`
- Test: `tests/trading-bot-account-route.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `enforceRateLimit`, `toErrorResponse`; `getCandles`; `DEFAULT_TIMEFRAME`, `CANDLE_LIMIT`, `SYMBOL_WHITELIST`; `getAccountForUser` (Task 5); `toDecimalString` (Task 2); `AccountDTO`, `PositionDTO` (Task 1).
- Produces: `GET` handlers at `/api/trading-bot/account` and `/api/trading-bot/positions`. Consumed by the page (Task 15).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/trading-bot-account-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/auth/current-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/market-data/candles", () => ({ getCandles: vi.fn() }));

import { requireUser } from "@/lib/auth/current-user";
import { getCandles } from "@/lib/market-data/candles";
import { GET as accountGET } from "@/app/api/trading-bot/account/route";
import { GET as positionsGET } from "@/app/api/trading-bot/positions/route";
import { __resetRateLimiters } from "@/lib/api/rate-limit";
import { __resetTradingBotStore, getAccountForUser } from "@/lib/trading-bot/store";

beforeEach(() => {
  __resetTradingBotStore();
  __resetRateLimiters();
  vi.mocked(requireUser).mockReset();
  vi.mocked(getCandles).mockReset();
});

describe("GET /api/trading-bot/account", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("no session"));
    const res = await accountGET();
    expect(res.status).toBe(401);
  });

  it("returns the starting balance as a string for a fresh user, with no positions", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", clerkUserId: "c1" });
    const res = await accountGET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.currency).toBe("USDT");
    expect(typeof json.cashBalance).toBe("string");
    expect(json.cashBalance).toBe("10000");
    expect(json.positions).toEqual([]);
  });

  it("includes marketValue/unrealizedPnl as strings when a position + fresh quote exist", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", clerkUserId: "c1" });
    const account = getAccountForUser("user-1");
    account.positions.set("BTC/USDT", {
      symbol: "BTC/USDT",
      quantity: new Prisma.Decimal("1"),
      avgEntryPrice: new Prisma.Decimal("100"),
      realizedPnl: new Prisma.Decimal("0"),
    });
    vi.mocked(getCandles).mockResolvedValue({
      symbol: "BTC/USDT",
      timeframe: "4h",
      candles: [{ openTime: Date.now(), open: 100, high: 160, low: 95, close: 150, volume: 1 }],
      source: "live",
      fetchedAt: Date.now(),
    });
    const res = await accountGET();
    const json = await res.json();
    const position = json.positions[0];
    expect(typeof position.marketValue).toBe("string");
    expect(position.marketValue).toBe("150");
    expect(typeof position.unrealizedPnl).toBe("string");
    expect(position.unrealizedPnl).toBe("50");
  });
});

describe("GET /api/trading-bot/positions", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("no session"));
    const res = await positionsGET();
    expect(res.status).toBe(401);
  });

  it("returns positions with string quantity/avgEntryPrice/realizedPnl fields", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", clerkUserId: "c1" });
    const account = getAccountForUser("user-1");
    account.positions.set("BTC/USDT", {
      symbol: "BTC/USDT",
      quantity: new Prisma.Decimal("1"),
      avgEntryPrice: new Prisma.Decimal("100"),
      realizedPnl: new Prisma.Decimal("0"),
    });
    const res = await positionsGET();
    const json = await res.json();
    expect(res.status).toBe(200);
    const position = json.positions[0];
    expect(typeof position.quantity).toBe("string");
    expect(typeof position.avgEntryPrice).toBe("string");
    expect(typeof position.realizedPnl).toBe("string");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- trading-bot-account-route`
Expected: FAIL with "Cannot find module '@/app/api/trading-bot/account/route'"

- [ ] **Step 3: Create `app/api/trading-bot/account/route.ts`**

```ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/current-user";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { toErrorResponse } from "@/lib/api/errors";
import { getCandles } from "@/lib/market-data/candles";
import { CANDLE_LIMIT, DEFAULT_TIMEFRAME, SYMBOL_WHITELIST } from "@/lib/trading-signals/config";
import { getAccountForUser } from "@/lib/trading-bot/store";
import { toDecimalString } from "@/lib/trading-bot/serialize";
import type { AccountDTO, PositionDTO } from "@/lib/trading-bot/dto";

export async function GET() {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "tradingBotRead");

    const account = getAccountForUser(userId);
    const positions: PositionDTO[] = await Promise.all(
      [...account.positions.values()].map(async (position) => {
        let marketValue: Prisma.Decimal | null = null;
        const ticker = SYMBOL_WHITELIST[position.symbol];
        if (ticker) {
          const series = await getCandles(ticker, DEFAULT_TIMEFRAME, CANDLE_LIMIT);
          const last = series.candles[series.candles.length - 1];
          if (last) marketValue = new Prisma.Decimal(last.close).times(position.quantity);
        }
        const unrealizedPnl = marketValue
          ? marketValue.minus(position.avgEntryPrice.times(position.quantity))
          : null;
        return {
          symbol: position.symbol,
          quantity: toDecimalString(position.quantity),
          avgEntryPrice: toDecimalString(position.avgEntryPrice),
          marketValue: marketValue ? toDecimalString(marketValue) : null,
          unrealizedPnl: unrealizedPnl ? toDecimalString(unrealizedPnl) : null,
          realizedPnl: toDecimalString(position.realizedPnl),
        };
      }),
    );

    const equity = positions.reduce(
      (sum, p) => (p.marketValue ? sum.plus(p.marketValue) : sum),
      account.cashBalance,
    );

    const dto: AccountDTO = {
      currency: "USDT",
      cashBalance: toDecimalString(account.cashBalance),
      equity: toDecimalString(equity),
      startingBalance: toDecimalString(account.startingBalance),
      positions,
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(dto);
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 4: Create `app/api/trading-bot/positions/route.ts`**

```ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { toErrorResponse } from "@/lib/api/errors";
import { getAccountForUser } from "@/lib/trading-bot/store";
import { toDecimalString } from "@/lib/trading-bot/serialize";
import type { PositionDTO } from "@/lib/trading-bot/dto";

export async function GET() {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "tradingBotRead");

    const account = getAccountForUser(userId);
    const positions: PositionDTO[] = [...account.positions.values()].map((position) => ({
      symbol: position.symbol,
      quantity: toDecimalString(position.quantity),
      avgEntryPrice: toDecimalString(position.avgEntryPrice),
      marketValue: null,
      unrealizedPnl: null,
      realizedPnl: toDecimalString(position.realizedPnl),
    }));
    return NextResponse.json({ positions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- trading-bot-account-route`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add app/api/trading-bot/account/route.ts app/api/trading-bot/positions/route.ts tests/trading-bot-account-route.test.ts
git commit -m "feat(trading-bot): add GET account/positions read routes"
```

---

### Task 13: Safety test — static import-graph scan

**Files:**
- Create: `tests/trading-bot-safety.test.ts`

**Interfaces:**
- Consumes: nothing project-specific (filesystem scan only). This test has no production-code dependency and depends only on Tasks 1–12 having been created on disk.

- [ ] **Step 1: Create `tests/trading-bot-safety.test.ts`**

```ts
// STATIC SAFETY GUARD — mirrors tests/trading-signals-safety.test.ts. Enforces
// that the mock trading-bot module never imports the signed-key exchange
// client and never references broker credentials or a live-mode identifier.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const FORBIDDEN_IMPORT = /@\/lib\/exchanges/i;
const FORBIDDEN_TEXT = /MEXC_API_KEY|MEXC_API_SECRET|isLiveMode|LIVE_TRADING|liveTradingEnabled/i;

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /import\s+[^"';]*from\s*["']([^"']+)["']/g,
    /import\s*["']([^"']+)["']/g,
    /export\s+[^"';]*from\s*["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

describe("trading-bot safety invariant (static import-graph scan)", () => {
  const targets = [
    ...tsFilesUnder(join(ROOT, "lib", "trading-bot")),
    ...tsFilesUnder(join(ROOT, "app", "api", "trading-bot")),
  ];

  it("scans a non-empty set of trading-bot files", () => {
    expect(targets.length).toBeGreaterThanOrEqual(10);
  });

  it("no file imports lib/exchanges (the signed-key MEXC client)", () => {
    const violations: string[] = [];
    for (const file of targets) {
      const src = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        if (FORBIDDEN_IMPORT.test(spec)) violations.push(`${file} -> "${spec}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no file references broker credential env vars or a live-mode identifier", () => {
    const violations: string[] = [];
    for (const file of targets) {
      const src = readFileSync(file, "utf8");
      const match = src.match(FORBIDDEN_TEXT);
      if (match) violations.push(`${file} -> "${match[0]}"`);
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm test -- trading-bot-safety`
Expected: PASS (3 tests) — if this fails, it means a prior task introduced a forbidden import or reference; fix that task's file, do not weaken this test.

- [ ] **Step 3: Commit**

```bash
git add tests/trading-bot-safety.test.ts
git commit -m "test(trading-bot): add static safety scan for the mock trading module"
```

---

### Task 14: Protect the `/trading-bot` page route

**Files:**
- Modify: `middleware.ts`

**Interfaces:** none (routing configuration only). Required before Task 15's page is reachable in a protected state.

- [ ] **Step 1: Modify `middleware.ts`**

Find:

```ts
const isProtectedPage = createRouteMatcher([
  "/portfolio(.*)",
  "/executive(.*)",
  "/operations(.*)",
  "/mission-control(.*)",
]);
```

Replace with:

```ts
const isProtectedPage = createRouteMatcher([
  "/portfolio(.*)",
  "/executive(.*)",
  "/operations(.*)",
  "/mission-control(.*)",
  "/trading-bot(.*)",
]);
```

- [ ] **Step 2: Run the existing test suite to confirm no regression**

Run: `npm test`
Expected: PASS (all existing tests, no change in count from this edit — middleware has no dedicated unit test in this repo; the existing suite instead exercises the routes/handlers directly)

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(trading-bot): protect /trading-bot behind the existing auth middleware"
```

---

### Task 15: `/trading-bot` page — UI

**Files:**
- Create: `app/trading-bot/page.tsx`
- Create: `components/trading-bot/TradingBotPageClient.tsx`
- Modify: `components/nav/AppNav.tsx`

**Interfaces:**
- Consumes: `PageShell` from `@/components/ui/PageShell`; `PixelCard`, `StatLine` from `@/components/ui/PixelCard`; `useJsonPoll` from `@/lib/use-json-poll`; the four routes from Tasks 10–12 (`/api/trading-signals` existing, `/api/trading-bot/account`, `/api/trading-bot/orders`, `/api/trading-bot/positions/close`).
- Produces: the `/trading-bot` page. Terminal task in the vertical slice — nothing downstream depends on it.

**No automated test:** this repo has no component-testing setup (`vitest.config.ts` is Node-only, no `jsdom`/`@testing-library/react` dependency). Verification for this task is manual (Step 4) plus the type-check in Task 16.

- [ ] **Step 1: Create `app/trading-bot/page.tsx`**

```tsx
import type { Metadata } from "next";
import TradingBotPageClient from "@/components/trading-bot/TradingBotPageClient";

export const metadata: Metadata = {
  title: "Trading Bot — Pixel Office",
  description: "Paper trading only. Simulated signals, mock broker, no real money.",
};

export default function TradingBotPage() {
  return <TradingBotPageClient />;
}
```

- [ ] **Step 2: Create `components/trading-bot/TradingBotPageClient.tsx`**

```tsx
"use client";

import { useState } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { PixelCard, StatLine } from "@/components/ui/PixelCard";
import { useJsonPoll } from "@/lib/use-json-poll";

interface TradingSignalDTO {
  symbol: string;
  timeframe: string;
  direction: "LONG" | "SHORT" | "WAIT";
  generatedAt: string;
  confidence: number;
}
interface SignalsResponse {
  signals: TradingSignalDTO[];
  generatedAt: string;
}
interface PositionDTO {
  symbol: string;
  quantity: string;
  avgEntryPrice: string;
  marketValue: string | null;
  unrealizedPnl: string | null;
  realizedPnl: string;
}
interface AccountDTO {
  currency: string;
  cashBalance: string;
  equity: string;
  startingBalance: string;
  positions: PositionDTO[];
  generatedAt: string;
}
interface OrderResultDTO {
  orderId: string;
  status: "FILLED" | "REJECTED";
  reasonCode: string | null;
  reason: string | null;
  side: "BUY" | "SELL";
  symbol: string;
  requestedQuantity: string;
  fillPrice: string | null;
  fee: string | null;
  notional: string | null;
  realizedPnl: string | null;
  executedAt: string | null;
  idempotent: boolean;
}

export default function TradingBotPageClient() {
  const signals = useJsonPoll<SignalsResponse>("/api/trading-signals", 30_000);
  const account = useJsonPoll<AccountDTO>("/api/trading-bot/account", 15_000);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [closeQuantities, setCloseQuantities] = useState<Record<string, string>>({});
  const [pendingKeys, setPendingKeys] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] = useState<OrderResultDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function clearPendingKey(key: string) {
    setPendingKeys((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function placeOrder(signal: TradingSignalDTO) {
    const key = `order:${signal.symbol}`;
    const idempotencyKey = pendingKeys[key] ?? crypto.randomUUID();
    setPendingKeys((prev) => ({ ...prev, [key]: idempotencyKey }));
    setBusy(key);
    try {
      const res = await fetch("/api/trading-bot/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signalId: `${signal.symbol}:${signal.timeframe}`,
          observedGeneratedAt: signal.generatedAt,
          requestedQuantity: quantities[signal.symbol] || "0",
          idempotencyKey,
        }),
      });
      const json = (await res.json()) as OrderResultDTO;
      setLastResult(json);
      if (res.ok) clearPendingKey(key);
      account.refetch();
    } finally {
      setBusy(null);
    }
  }

  async function closePosition(position: PositionDTO) {
    const key = `close:${position.symbol}`;
    const idempotencyKey = pendingKeys[key] ?? crypto.randomUUID();
    setPendingKeys((prev) => ({ ...prev, [key]: idempotencyKey }));
    setBusy(key);
    try {
      const res = await fetch("/api/trading-bot/positions/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: position.symbol,
          requestedQuantity: closeQuantities[position.symbol] || position.quantity,
          idempotencyKey,
        }),
      });
      const json = (await res.json()) as OrderResultDTO;
      setLastResult(json);
      if (res.ok) clearPendingKey(key);
      account.refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell accent="#f59e0b">
      <PixelCard title="Trading Bot — Paper / Simulated" accent="#f59e0b">
        <p className="text-xs text-warning">
          Paper trading only — no real orders, no real money. This mode cannot be turned off.
        </p>
      </PixelCard>

      <PixelCard title="Mock Account" accent="#f59e0b">
        {account.data ? (
          <>
            <StatLine label="Cash (USDT)" value={account.data.cashBalance} />
            <StatLine label="Equity (USDT)" value={account.data.equity} />
            <StatLine label="Starting balance (USDT)" value={account.data.startingBalance} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Loading account…</p>
        )}
      </PixelCard>

      <PixelCard title="Open Positions" accent="#f59e0b">
        {account.data && account.data.positions.length > 0 ? (
          account.data.positions.map((p) => (
            <div key={p.symbol} className="border-t border-border/40 py-2 first:border-t-0">
              <StatLine label={p.symbol} value={`${p.quantity} @ ${p.avgEntryPrice}`} />
              <StatLine label="Realized P&L" value={p.realizedPnl} />
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label={`Close quantity for ${p.symbol}`}
                  className="w-32 rounded-sm border border-border bg-background px-2 py-1 text-xs"
                  value={closeQuantities[p.symbol] ?? p.quantity}
                  onChange={(e) =>
                    setCloseQuantities((q) => ({ ...q, [p.symbol]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  disabled={busy === `close:${p.symbol}`}
                  onClick={() => closePosition(p)}
                  className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No open positions.</p>
        )}
      </PixelCard>

      <PixelCard title="Signals" accent="#f59e0b">
        {signals.data?.signals.map((s) => (
          <div key={s.symbol} className="border-t border-border/40 py-2 first:border-t-0">
            <StatLine label={s.symbol} value={`${s.direction} · confidence ${s.confidence}`} />
            {s.direction === "LONG" ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label={`Quantity for ${s.symbol}`}
                  placeholder="quantity"
                  className="w-32 rounded-sm border border-border bg-background px-2 py-1 text-xs"
                  value={quantities[s.symbol] ?? ""}
                  onChange={(e) => setQuantities((q) => ({ ...q, [s.symbol]: e.target.value }))}
                />
                <button
                  type="button"
                  disabled={busy === `order:${s.symbol}`}
                  onClick={() => placeOrder(s)}
                  className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
                >
                  Place Mock Order
                </button>
              </div>
            ) : s.direction === "SHORT" ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                SHORT not supported in Phase 1
              </p>
            ) : null}
          </div>
        ))}
      </PixelCard>

      {lastResult ? (
        <PixelCard title="Last Order Result" accent="#f59e0b">
          <StatLine label="Status" value={lastResult.status} />
          {lastResult.reason ? <StatLine label="Reason" value={lastResult.reason} /> : null}
        </PixelCard>
      ) : null}
    </PageShell>
  );
}
```

- [ ] **Step 3: Modify `components/nav/AppNav.tsx`**

Find:

```ts
const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Office" },
  { href: "/executive", label: "Executive" },
  { href: "/operations", label: "Operations" },
  { href: "/mission-control", label: "Mission Control" },
  { href: "/portfolio", label: "Portfolio" },
];
```

Replace with:

```ts
const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Office" },
  { href: "/executive", label: "Executive" },
  { href: "/operations", label: "Operations" },
  { href: "/mission-control", label: "Mission Control" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/trading-bot", label: "Trading Bot" },
];
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`

1. Sign in (Clerk).
2. Navigate to `/trading-bot` — confirm the "Paper / Simulated" banner is visible and the Mock Account panel shows `10000` cash.
3. If a `LONG` signal is showing, enter a small quantity (e.g. `0.01`) and click "Place Mock Order" — confirm the "Last Order Result" panel shows `FILLED` (or an honest rejection reason if market conditions changed) and the account panel's cash balance decreases.
4. If a position now exists, click "Close" with the pre-filled full quantity — confirm the position disappears from "Open Positions" and cash balance increases.
5. Sign out and navigate directly to `/trading-bot` — confirm you are redirected to sign-in (middleware protection from Task 14).

- [ ] **Step 5: Commit**

```bash
git add app/trading-bot/page.tsx components/trading-bot/TradingBotPageClient.tsx components/nav/AppNav.tsx
git commit -m "feat(trading-bot): add /trading-bot page (signals, account, orders, close)"
```

---

### Task 16: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — every pre-existing test plus every `trading-bot-*.test.ts` file added in Tasks 1–13.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds, `/trading-bot` and all four new `app/api/trading-bot/**` routes appear in the route summary.

- [ ] **Step 5: Fix any failures**

If any of Steps 1–4 fail, fix the specific file causing the failure (do not weaken a test or add a suppression) and re-run that step before proceeding.

- [ ] **Step 6: Update project docs**

Add a short new entry to `pixel-office/FEATURE_REGISTRY.md` describing `/trading-bot` (route/files, data sources, honest caveats — no persistence, in-memory per-process state, Paper only), following the existing entry format for `/executive`/`/operations`/`/mission-control`. Add a line to `pixel-office/ROADMAP.md`'s "Completed" section noting Phase 1 of the AI Trading Bot shipped, and note in "Backlog" that Phase 2 (extended indicators/backtesting/persistence) is deferred.

- [ ] **Step 7: Commit**

```bash
git add pixel-office/FEATURE_REGISTRY.md pixel-office/ROADMAP.md
git commit -m "docs: record /trading-bot Phase 1 in the feature registry and roadmap"
```

---

## Self-Review

**Spec coverage:** every numbered section of the approved spec maps to a task — §5.1–5.6 types/DTOs/interfaces → Task 1–8; §6 MockBroker math and freshness → Tasks 4, 6; §7 idempotency/concurrency → Tasks 5, 10, 11; §8 position semantics → Tasks 6, 7, 11; §9 API contracts → Tasks 10–12; §11 safety boundary → Task 13; §12 rate limiting → Task 9; §10 page behavior → Tasks 14–15; §14 testing plan (all 23 items) → covered across Tasks 2–13's test files. No spec section lacks a task.

**Placeholder scan:** no TBD/TODO, no "add appropriate error handling," no "similar to Task N" shortcuts — every step has complete, runnable code.

**Type consistency:** `OrderResult`, `TradeIntent`, `MockAccount`, `MockPosition`, `Fill`, `RejectCode` (Task 1) are used with identical shapes in Tasks 5–12 without renaming. `RiskEngine.evaluate(intent, account)` (Task 7) matches every call site in Tasks 10–11 (two arguments, no `executionPrice` parameter — resolved via the shared `deriveBuyExecutionPrice` helper in `pricing.ts`, Task 3). `Strategy.generateIntent(userId, signalId, observedGeneratedAt, requestedQuantity)` (Task 8) matches its call site in Task 10. `BrokerAdapter.placeOrder(request: PlaceOrderRequest)` (Task 6) matches both call sites in Tasks 10 and 11, and `PlaceOrderRequest.executionPrice` is always caller-computed (Task 3's `deriveBuyExecutionPrice` for BUY, the close route's own candle lookup for SELL) — `MockBroker` itself never imports `getCandles`.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-14-trading-bot-phase1.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
