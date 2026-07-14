# AI Trading Bot — Phase 1 Design (Interfaces + Mock Broker)

Status: **approved** (2026-07-14). Scope: **Phase 1 only** — architecture,
interfaces, and a mock broker, integrated into the existing `pixel-office`
Next.js app. No persistence, no automation, no live trading, no broker
credentials. Phases 2–7 (extended indicators, backtesting, persisted paper
trading, sandbox/testnet, guarded live trading, security/monitoring) are out
of scope for this document and for this implementation pass.

All monetary values in this module (cash, notional, fees, P&L) are
denominated in **USDT**, matching the quote currency of every
`SUPPORTED_SYMBOLS` pair (`BTC/USDT`, `ETH/USDT`, `SOL/USDT`). There is no FX
conversion anywhere in this module.

## 1. Context

`pixel-office` already has:

- Clerk auth (`requireUser()` in `lib/auth/current-user.ts`), Neon Postgres +
  Prisma, and a page-protection middleware pattern (`middleware.ts`
  `isProtectedPage`).
- A read-only, analysis-only signal engine at `lib/trading-signals/` (SMA/EMA/
  RSI/ATR, swing high/low S/R, risk-gated entry/stop/target/confidence/
  reasoning) fed by keyless public MEXC klines (`lib/market-data/candles.ts`).
  That module carries a hard safety invariant: **no order/withdraw/transfer/
  execute capability anywhere in its file tree.** This spec does not modify
  it and does not weaken that invariant.
- A **separate**, signed-key, read-only MEXC account client
  (`lib/exchanges/mexc.ts`) used only for the existing balance/order *display*
  widgets. This spec does not use or extend it.
- An existing `GET /api/trading-signals` route returning
  `TradingSignal[]` for `SUPPORTED_SYMBOLS` (`BTC/USDT`, `ETH/USDT`,
  `SOL/USDT`) at `DEFAULT_TIMEFRAME` (`"4h"`).
- A per-user in-memory rate limiter (`lib/api/rate-limit.ts`) with a closed
  `RateLimitBucket` union, extended additively in the past (e.g.
  `signalsRead`).
- A `Portfolio` Prisma schema (manual DCA transaction ledger) that is
  **unrelated** to this work — the trading bot's paper account is a separate,
  simulated concept and must not read or write `Transaction`/`Holding`.

Phase 1 builds a new, isolated module, `lib/trading-bot/`, plus one new
protected page (`/trading-bot`) and a small number of new API routes. It
*consumes* `lib/trading-signals`'s pure outputs and nothing else from that
module's surroundings.

## 2. Goals / Non-goals

**Goals (Phase 1):**

- Define `BrokerAdapter`, `Strategy`, `TradeIntent`, `RiskEngine` as explicit
  TypeScript contracts.
- Implement `MockBroker`: an in-memory, per-user, long-only paper-trading
  simulator with precise fee/fill/average-cost/realized-P&L math.
- Wire one working, server-authoritative, idempotent, pipeline-complete path:
  canonical signal → `Strategy` → `TradeIntent` → `RiskEngine` (stub) →
  `MockBroker` → `Fill`, reachable from a minimal UI.
- Prove the safety boundary holds (no live broker reachable, no credentials,
  no automation) with an explicit test.

**Non-goals (deferred to later phases, not built here):**

- Database persistence of orders/positions/fills (Phase 4). State lives in
  process memory and is explicitly **not deployment-safe** (see §6).
- Full risk engine (daily loss limit, drawdown, exposure caps, cooldown,
  circuit breakers, kill switch) — Phase 4. The Phase 1 `StubRiskEngine` has
  exactly the rules listed in §5.
- Backtesting (Phase 3), extended indicators/MACD/Bollinger/multi-timeframe
  (Phase 2 proper — Phase 1 reuses the existing engine as-is), broker
  connection settings, 2FA/live-mode gating, audit log, bot start/stop
  automation, limit orders, partial fills, slippage modeling, margin/leverage,
  short-selling.
- Account reset / configurable starting balance UI (Phase 1 balance is a
  fixed, named server-side constant — see §6).

## 3. Assumptions

- "User" = an authenticated Clerk user (`requireUser()` returns an internal
  `userId`), exactly as the existing Portfolio/agents routes work.
- Phase 1 operates only on `SUPPORTED_SYMBOLS` and `DEFAULT_TIMEFRAME` from
  `lib/trading-signals/config.ts` — no new symbol or timeframe surface.
- "Deployment-safe" is out of scope for Phase 1 by design (see §6); the
  existing repo already ships other per-instance in-memory state (rate
  limiter, agents cache) with the same documented caveat, so this follows
  established precedent rather than introducing a new pattern.
- A "Close Position" (SELL) action is approved as in-scope for Phase 1,
  extending the original thin-slice UI, because it completes the long-only
  mock position lifecycle (open via BUY, reduce/close via SELL) and lets it
  be tested end-to-end. It is exposed as a second, minimal,
  signal-independent endpoint (§9) and is deliberately narrow: full pipeline
  (auth → validation → risk evaluation → idempotency/locking → `MockBroker`
  execution → result reporting), reduce-or-close an existing long position
  only, no naked SELL/short/leverage/margin/reversal, server-derived price
  and quantity, and never dependent on receiving any signal (SHORT or
  otherwise) — see §6, §9, §10.
- Signal *age* (how long ago the signal instance the user is acting on was
  generated) and candle *data freshness* (how current the underlying market
  data is) are validated independently — see §5.4 and §6. A valid signal on
  a slower timeframe (e.g. 4h) is never rejected merely because its last
  closed candle is more than 5 minutes old.

## 4. Architecture

```
GET /api/trading-signals (existing, unmodified)
        │  TradingSignal[] (pure data, no execution capability)
        ▼
SignalEngineStrategy.generateIntent(symbol)   [lib/trading-bot/strategy.ts]
        │  re-derives the signal server-side; never trusts client-supplied levels
        ▼
TradeIntent                                    [lib/trading-bot/types.ts]
        ▼
StubRiskEngine.evaluate(intent, account)       [lib/trading-bot/risk-engine.ts]
        │  approve | reject (with reasons)
        ▼
MockBroker.placeOrder(request)                 [lib/trading-bot/mock-broker.ts]
        │  keyed by userId; idempotent; in-memory
        ▼
Fill / OrderResult  →  serialized as decimal-string DTOs → JSON response
```

All mutation happens behind `POST /api/trading-bot/orders` (BUY, signal-
driven) and `POST /api/trading-bot/positions/close` (SELL, position-driven).
The page never constructs price, stop-loss, notional, or intent — it only
submits a signal reference, a requested quantity, and an idempotency key.

## 5. Module layout and type contracts

```
lib/trading-bot/
  types.ts          — domain types (Decimal-based, server-only)
  dto.ts            — public JSON contract types (string-based, safe for client import)
  serialize.ts       — Decimal <-> string conversion + validation, both directions
  broker-types.ts    — BrokerAdapter interface
  mock-broker.ts     — MockBroker (in-memory, per-user)
  store.ts           — per-user account store + per-user async lock
  strategy.ts         — Strategy interface + SignalEngineStrategy
  risk-engine.ts       — RiskEngine interface + StubRiskEngine
  pricing.ts           — shared fee/notional math used identically by RiskEngine and MockBroker
  freshness.ts          — shared candle-staleness check, used by both the BUY (Strategy) and SELL (MockBroker) paths
  config.ts            — Phase 1 constants (fee rate, starting balance, signal-freshness window, candle-staleness grace)
  errors.ts            — typed rejection reasons / error codes
app/trading-bot/
  page.tsx             — protected page
app/api/trading-bot/
  account/route.ts
  orders/route.ts
  positions/route.ts
  positions/close/route.ts
```

### 5.1 Domain types (`types.ts`, server-only, uses `Prisma.Decimal`)

```ts
import { Prisma } from "@prisma/client";
type Decimal = Prisma.Decimal;

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "FILLED" | "REJECTED";

export interface TradeIntent {
  userId: string;
  symbol: string;              // one of SUPPORTED_SYMBOLS
  timeframe: "4h";              // DEFAULT_TIMEFRAME only, Phase 1
  side: OrderSide;
  requestedQuantity: Decimal;   // user-controlled input, validated
  // Present for BUY (signal-derived); absent for SELL (position-derived).
  sourceSignal?: {
    direction: "LONG";           // SHORT is rejected before a TradeIntent exists (§5.4)
    entryZone: { low: number; high: number };
    stopLoss: number;
    takeProfit: { price: number; label: string }[];
    riskRewardRatio: number | null;
    confidence: number;
    generatedAt: string;
  };
  createdAt: string;
}

export interface MockAccount {
  userId: string;
  cashBalance: Decimal;
  startingBalance: Decimal;
  positions: Map<string, MockPosition>; // key: symbol
}

export interface MockPosition {
  symbol: string;
  quantity: Decimal;      // always > 0 while present; zeroed positions are removed
  avgEntryPrice: Decimal;
  realizedPnl: Decimal;   // cumulative, across all closes of this symbol
}

export interface Fill {
  orderId: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: Decimal;
  price: Decimal;
  fee: Decimal;
  notional: Decimal;
  realizedPnl: Decimal | null; // set for SELL only
  executedAt: string;
}

export interface OrderResult {
  orderId: string;
  status: OrderStatus;
  reasonCode: RejectCode | null;
  reason: string | null;
  side: OrderSide;
  symbol: string;
  requestedQuantity: Decimal;
  fill: Fill | null;
  idempotent: boolean; // true when served from the idempotency cache
}

export type RejectCode =
  | "UNRECOGNIZED_SIGNAL"
  | "NON_ACTIONABLE_SIGNAL"
  | "UNSUPPORTED_SHORT"
  | "STALE_SIGNAL"          // the signal INSTANCE the user acted on is too old (observedGeneratedAt)
  | "STALE_CANDLE_DATA"     // the underlying market data is too old, independent of signal age
  | "INVALID_QUANTITY"
  | "MISSING_STOP_LOSS"
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_POSITION"
  | "NO_OPEN_POSITION";
```

### 5.2 Public DTOs (`dto.ts`, client-safe, no `@prisma/client` import)

All monetary and quantity fields are `string`. Example:

```ts
export interface AccountDTO {
  cashBalance: string;
  equity: string;               // cashBalance + sum(position market value)
  startingBalance: string;
  positions: PositionDTO[];
  generatedAt: string;
}

export interface PositionDTO {
  symbol: string;
  quantity: string;
  avgEntryPrice: string;
  marketValue: string | null;   // null if a fresh quote could not be fetched
  unrealizedPnl: string | null;
  realizedPnl: string;
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

`serialize.ts` owns both directions:

- `toDecimalString(d: Decimal): string` — `d.toString()` (exact, no implicit
  rounding at the serialization boundary; rounding happens earlier, at
  computation time, per §7).
- `parseQuantityInput(raw: unknown): Decimal` — throws `INVALID_QUANTITY`
  unless `raw` is a `string` matching `/^\d{1,18}(\.\d{1,10})?$/`, is finite,
  and is `> 0`. Rejects numbers (JS `number` is never accepted as monetary/
  quantity input — only strings), exponential notation, signs, multiple dots,
  empty string, and over-precision input.

### 5.3 `BrokerAdapter` (`broker-types.ts`)

```ts
export interface BrokerAdapter {
  getAccount(userId: string): Promise<MockAccount>;
  placeOrder(request: PlaceOrderRequest): Promise<OrderResult>;
  getPositions(userId: string): Promise<MockPosition[]>;
}

export interface PlaceOrderRequest {
  userId: string;
  idempotencyKey: string;
  intent: TradeIntent;             // already RiskEngine-approved by the caller
  executionPrice: Decimal;         // server-derived; the adapter never re-derives it
}
```

`connect()`, `cancelOrder()`, `getOpenOrders()` from the original approved
sketch are **not** included in Phase 1: Phase 1 has no pending/cancelable
order state (every order resolves synchronously to FILLED or REJECTED — no
limit orders yet), so those methods would be dead code. They are documented
here as known Phase 4 additions to this interface, not silently dropped.

### 5.4 `Strategy` (`strategy.ts`)

```ts
export interface Strategy {
  generateIntent(
    userId: string,
    signalId: string,
    observedGeneratedAt: string,
    requestedQuantity: Decimal,
  ): Promise<
    | { ok: true; intent: TradeIntent }
    | { ok: false; code: RejectCode; reason: string }
  >;
}
```

`SignalEngineStrategy.generateIntent` deliberately fetches candles itself
(`getCandles`, same function `lib/trading-signals` uses internally) instead
of calling `generateSignals` directly, because the raw `CandleSeries` (with
each candle's `openTime`) is needed for the candle-freshness check in step 3
— `TradingSignal` itself carries no candle timestamp.

1. Parse `signalId` as `"<symbol>:<timeframe>"`. Reject
   `UNRECOGNIZED_SIGNAL` unless `symbol ∈ SUPPORTED_SYMBOLS` and
   `timeframe === DEFAULT_TIMEFRAME`.
2. `series = await getCandles(ticker, timeframe, CANDLE_LIMIT)` — live,
   server-side, public/keyless (same call `generateSignals` makes
   internally).
3. **Candle-data-freshness check** (independent of signal age — see §6 for
   the shared `checkCandleFreshness` helper and exact rule): if
   `series.candles` is non-empty, run `checkCandleFreshness(series.candles,
   timeframe, now)`. If it reports stale → reject `STALE_CANDLE_DATA`
   *before* spending effort building a signal from data already known to be
   too old. (An empty `series.candles`, i.e. `source: "insufficient"`, is
   also reported as `STALE_CANDLE_DATA` by the helper — "no data" and "old
   data" are both "can't currently trust this market data.")
4. `signal = buildSignalFromCandles(series, nowIso)`. The client's copy of
   entry/stop/target/confidence is never read or trusted for anything other
   than display — this is always a fresh, server-side computation.
5. If `signal.direction === "WAIT"` or `signal.source === "insufficient-data"`
   → reject `NON_ACTIONABLE_SIGNAL`.
6. If `signal.direction === "SHORT"` → reject `UNSUPPORTED_SHORT` (§8: Phase 1
   is long-only).
7. **Signal-instance-age check** (independent of step 3 — this bounds how
   long ago the *specific signal the user looked at and decided to act on*
   was generated, not how current the market data is): if
   `Date.now() - Date.parse(observedGeneratedAt) > SIGNAL_FRESHNESS_WINDOW_MS`
   (5 minutes) → reject `STALE_SIGNAL`. A signal on a slow timeframe (4h) can
   pass this check every time it's re-submitted promptly, regardless of how
   old its underlying candle is — the two checks measure different things
   and neither substitutes for the other.
8. Quantity check: `parseQuantityInput` already ran in the route; a defensive
   re-check here rejects `INVALID_QUANTITY` for `<= 0`.
9. Otherwise construct `TradeIntent` with `side: "BUY"`, the just-regenerated
   `sourceSignal` fields, and the validated `requestedQuantity`.

### 5.5 `RiskEngine` (`risk-engine.ts`)

```ts
export interface RiskEngine {
  evaluate(
    intent: TradeIntent,
    account: MockAccount,
  ): { approved: true } | { approved: false; code: RejectCode; reason: string };
}
```

`StubRiskEngine` rules — **exactly these four, nothing else**:

1. BUY: `intent.sourceSignal.stopLoss` must be non-null →
   else `MISSING_STOP_LOSS`.
2. BUY: `estimateOrderCost(intent, executionPrice)` (notional + fee, via the
   shared `pricing.ts` function also used by `MockBroker`) must be
   `<= account.cashBalance` → else `INSUFFICIENT_FUNDS`. This is a
   cash/equity check on the *total cost of the order*, not a comparison of
   raw quantity against equity.
3. SELL: `intent.requestedQuantity` must be `<= ` the held position's
   quantity for `intent.symbol` (0 if no position) → else
   `INSUFFICIENT_POSITION`, or `NO_OPEN_POSITION` if none exists.
4. Both: `intent.requestedQuantity` must be a positive, finite, correctly-
   formatted decimal (defensive re-check) → else `INVALID_QUANTITY`.

Explicitly documented in-file: this is **not** the Risk Engine described in
the full spec (no daily loss limit, drawdown limit, exposure cap, position
count cap, cooldown, session restriction, circuit breaker, or kill switch).
Phase 4 replaces this file's contents, not its interface.

Signal-age (`STALE_SIGNAL`) and candle-data-freshness (`STALE_CANDLE_DATA`)
are deliberately **not** `StubRiskEngine` rules — they gate *whether a
`TradeIntent` can be constructed or priced at all* (upstream, in `Strategy`
for BUY; at execution time in `MockBroker` for SELL, since SELL has no
`Strategy` call), not whether an already-well-formed intent is an acceptable
size/risk. `StubRiskEngine` only ever sees intents built from data already
known to be fresh.

### 5.6 Shared pricing math (`pricing.ts`)

Used identically by `StubRiskEngine` (to estimate cost before approval) and
`MockBroker` (to actually execute), so the two can never disagree:

```ts
export function estimateOrderCost(notional: Decimal, feeRate: Decimal): Decimal;
// returns notional + (notional * feeRate), Decimal math throughout
```

## 6. `MockBroker` — semantics and math

**Configuration constants (`lib/trading-bot/config.ts`)** — named, not
inlined, so later phases can change them without touching execution logic:

```ts
export const PAPER_STARTING_BALANCE_USDT = new Decimal("10000.00");
export const MOCK_FEE_RATE = new Decimal("0.001"); // 0.1%, applied identically to BUY notional and SELL proceeds
export const SIGNAL_FRESHNESS_WINDOW_MS = 5 * 60_000; // 5 minutes — signal INSTANCE age
```

`MOCK_FEE_RATE` is read from this single constant everywhere a fee is
computed: `pricing.ts#estimateOrderCost` (used by `StubRiskEngine`), the
`MockBroker` BUY and SELL execution paths below, and every test fixture —
there is no second, independently-maintained fee number anywhere.

**Shared candle-freshness check (`freshness.ts`)** — used by both the BUY
path (`Strategy`, §5.4 step 3) and the SELL path (this section, "Execution —
SELL" step 1):

```ts
export const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};
export const CANDLE_STALENESS_GRACE_MS = 5 * 60_000; // small documented grace period

export function checkCandleFreshness(
  candles: Candle[],
  timeframe: Timeframe,
  now: number,
): { ok: true } | { ok: false; code: "STALE_CANDLE_DATA"; reason: string };
```

Rule: let `last = candles[candles.length - 1]`. Stale
(`STALE_CANDLE_DATA`) when `candles` is empty, **or** when
`now - last.openTime > TIMEFRAME_DURATION_MS[timeframe] +
CANDLE_STALENESS_GRACE_MS` — i.e. the most recent candle must have opened
within one full timeframe interval plus the grace period. For `"4h"` this is
a ~4h05m ceiling on candle age, entirely independent of the 5-minute
`SIGNAL_FRESHNESS_WINDOW_MS` signal-instance-age check in §5.4 step 7. A
signal is never rejected under this rule merely for being "more than five
minutes old" — that number governs signal age, not candle age.

**Deployment-safety caveat (documented at the top of `store.ts` and in this
spec):** `store.ts` holds a module-scoped `Map<userId, MockAccount>`. This
works correctly in a single warm Node process (local dev, `npm run dev`, a
single long-lived server instance). **It is not safe on serverless/multi-
instance deployment** (e.g. Vercel functions): concurrent requests may land
on different instances, each with its own empty map, silently losing or
duplicating state. This mirrors the existing, already-documented caveat on
`lib/api/rate-limit.ts` and `lib/agents/agents-cache.ts`. Phase 4 replaces
this store with Postgres-backed persistence (`Order`/`Fill`/`Position`
tables with a unique constraint on `(userId, idempotencyKey)`, the same
pattern already used for `Transaction`'s `(portfolioId, source, externalId)`
import-idempotency constraint). Phase 1 does not attempt to work around this
caveat — it states it and defers the fix.

**User isolation:** every account, position, order, and idempotency record is
keyed by the authenticated `userId` from `requireUser()`. No cross-user
lookup path exists anywhere in `lib/trading-bot/`. `getAccount`,
`placeOrder`, and `getPositions` all require `userId` as an explicit,
non-optional parameter (never inferred from a global/module-level "current
user").

**Long-only invariant:** a `SELL` may only ever reduce or fully close an
existing long position for that user+symbol. There is no naked SELL, no
short-selling, no leverage, no margin, no position reversal, and no negative
position quantity anywhere in Phase 1 — a `SELL` whose `requestedQuantity`
would take `position.quantity` below zero (including when no position exists
at all) is rejected (`INSUFFICIENT_POSITION` / `NO_OPEN_POSITION`), never
clamped or partially honored.

**Execution — BUY (from a `TradeIntent` approved by `StubRiskEngine`):**

1. `executionPrice` = midpoint of `sourceSignal.entryZone` (`(low + high) /
   2`), computed server-side. No slippage model in Phase 1 (deferred to
   Phase 4) — the fill price *is* the computed midpoint, exactly.
2. `notional = executionPrice * requestedQuantity`.
3. `fee = notional * MOCK_FEE_RATE` (Decimal math).
4. `totalCost = notional + fee`. If `totalCost > cashBalance` → `REJECTED /
   INSUFFICIENT_FUNDS` (this must already have been caught by the risk
   engine using the same `pricing.ts` function; the broker re-checks
   defensively and is the actual source of truth for the mutation).
5. `cashBalance -= totalCost`.
6. Position update (weighted-average cost, matching the existing Portfolio
   module's `AVERAGE_COST` convention):
   - No existing position: create `{ quantity: requestedQuantity,
     avgEntryPrice: executionPrice, realizedPnl: 0 }`.
   - Existing position: `newQuantity = oldQuantity + requestedQuantity`;
     `newAvgEntryPrice = (oldQuantity * oldAvgEntryPrice + requestedQuantity *
     executionPrice) / newQuantity`.
7. Record a `Fill` (`realizedPnl: null` for BUY) and an `OrderResult` with
   `status: "FILLED"`.

**Execution — SELL (close position; no signal, no `StubRiskEngine` cash
check — only the position-quantity check, StubRiskEngine rule 3, which needs
no price and runs before any candle fetch):**

1. Fetch `series = await getCandles(ticker, timeframe, CANDLE_LIMIT)` — the
   same keyless public candle source `lib/trading-signals` already uses,
   using `DEFAULT_TIMEFRAME`. **Not** the Portfolio module's
   `MarketDataService`, which is keyed by a different `Asset`/symbol universe
   (`"BTC"` + `AssetType`, Finnhub/CoinGecko) and must not be conflated with
   the trading-signals `"BTC/USDT"` MEXC-ticker universe. Run
   `checkCandleFreshness(series.candles, timeframe, now)` — if stale or empty
   → reject `STALE_CANDLE_DATA` (no fabricated price; no mutation). This is
   the same shared check the BUY path runs, applied here because SELL has no
   `Strategy` call to have already run it. Otherwise `executionPrice` = the
   last candle's `close`.
2. `proceeds = executionPrice * requestedQuantity`;
   `fee = proceeds * MOCK_FEE_RATE`; `netProceeds = proceeds - fee`.
3. `realizedPnl = (executionPrice - position.avgEntryPrice) *
   requestedQuantity - fee`.
4. `cashBalance += netProceeds`.
5. `position.quantity -= requestedQuantity`; `position.realizedPnl +=
   realizedPnl`. If the resulting quantity is `0`, remove the position
   entirely (avgEntryPrice becomes meaningless at zero size). Remaining
   quantity keeps its existing `avgEntryPrice` unchanged (standard average-
   cost partial-close accounting).
6. Record a `Fill` (`realizedPnl` populated) and an `OrderResult` with
   `status: "FILLED"`.

**Rounding:** all Decimal outputs that are persisted into account/position
state are rounded to 8 decimal places, `ROUND_HALF_UP`
(`decimal.toDecimalPlaces(8, Decimal.ROUND_HALF_UP)`), immediately after
computation and before being stored — not at serialization time — so stored
state and its serialized string form always agree exactly. Quantities are
validated on input to at most 10 decimal places (matching
`Transaction.quantity`'s existing `Decimal(30,10)` convention) and are never
independently re-rounded.

**Rejections never throw.** Every expected paper-trading outcome (missing
stop, insufficient funds, insufficient position, stale or unavailable candle
data) returns `{ status: "REJECTED", reasonCode, reason }`. Only malformed
input (caught earlier, at the route/DTO boundary) or a genuine unexpected
fault produces an HTTP 4xx/5xx.

## 7. Idempotency and concurrency

- `idempotencyKey` is a required, non-empty string (`<= 128` chars),
  supplied by the caller, on both `PlaceOrderRequest` and the two POST route
  bodies.
- Per-user idempotency index: each `MockAccount`'s store entry includes a
  `Map<idempotencyKey, OrderResult>`. Keys are **scoped to the user** — two
  different users may reuse the same literal key string with no interaction
  between them (isolation, not just deduplication).
- `store.ts` exports `withUserLock(userId, fn): Promise<T>`, a per-`userId`
  promise-chained mutex (each call for a given `userId` waits for the
  previous one to finish before running). Every mutating call
  (`placeOrder`) runs its *entire* check-idempotency → execute-pipeline →
  record-result sequence inside `withUserLock`, closing the check-then-act
  race between two concurrent requests carrying the same key.
- Order of operations inside the lock: look up `idempotencyKey` in the
  user's index → if present, return the stored `OrderResult` with
  `idempotent: true` and **do not** re-run `Strategy`/`RiskEngine`/execution
  → if absent, run the full pipeline, store the result under that key, return
  it with `idempotent: false`.
- **Scope of this guarantee, stated explicitly:** this protects against
  duplicate/concurrent submission *within a single Node process*. It does
  **not** protect across multiple serverless instances (same caveat as §6).
  Phase 4's DB-backed version enforces this with a unique constraint on
  `(userId, idempotencyKey)` instead of an in-process lock.

## 8. Position semantics (long-only)

- `LONG` signal direction → `BUY` intent.
- `WAIT` → no intent constructed; the route responds with a `NO_ACTION`-style
  200 (not an error) carrying `reasonCode: "NON_ACTIONABLE_SIGNAL"`, since
  "the signal says wait" is an expected, non-exceptional outcome.
- `SHORT` → rejected before a `TradeIntent` is ever constructed
  (`UNSUPPORTED_SHORT`). No short position, margin, or leverage exists in
  Phase 1.
- `SELL` is only reachable via the position-close path (§9), never via a
  signal, and can only ever reduce quantity already owned by that user for
  that symbol — enforced independently by both `StubRiskEngine` (rule 3, §5.5)
  and `MockBroker` itself (defensive re-check, §6).

## 9. API contracts

Every route below calls `requireUser()` itself, first, regardless of
middleware protecting the page (§11) — authorization is never inferred from
the caller having reached the route at all.

### `GET /api/trading-bot/account`

- Auth: `requireUser()`. Rate limit: new bucket `tradingBotRead` (see §12).
- 200 → `AccountDTO` (§5.2). `marketValue`/`unrealizedPnl` per position are
  computed from a fresh `getCandles` close price; `null` if unavailable
  (never fabricated).
- 401 unauthenticated.

### `GET /api/trading-bot/positions`

- Same auth/rate-limit as above. 200 → `PositionDTO[]`.

### `POST /api/trading-bot/orders` (BUY, signal-driven)

Request body:

```json
{
  "signalId": "BTC/USDT:4h",
  "observedGeneratedAt": "2026-07-14T10:00:00.000Z",
  "requestedQuantity": "0.0500000000",
  "idempotencyKey": "a5e6b6d2-...-uuid"
}
```

- Auth: `requireUser()`. Rate limit: new bucket `tradingBotWrite`.
- 400 if the body is malformed (missing field, quantity fails
  `parseQuantityInput`, empty/oversized `idempotencyKey`, unparseable
  `observedGeneratedAt`).
- 200 → `OrderResultDTO` for **every other outcome**, including rejections —
  a rejection is a valid, fully-handled response, not a server error.
  `status`/`reasonCode` distinguish `FILLED` from each `RejectCode` in §5.1
  (`UNRECOGNIZED_SIGNAL`, `NON_ACTIONABLE_SIGNAL`, `UNSUPPORTED_SHORT`,
  `STALE_SIGNAL`, `STALE_CANDLE_DATA`, `MISSING_STOP_LOSS`,
  `INSUFFICIENT_FUNDS`, etc.). `STALE_SIGNAL` and `STALE_CANDLE_DATA` are
  reported as distinct codes with distinct `reason` text — a caller can tell
  "your view of the signal is old, refresh it" apart from "the market data
  itself is currently stale."
- 401 unauthenticated. 429 rate-limited.

### `POST /api/trading-bot/positions/close` (SELL, position-driven)

Request body:

```json
{
  "symbol": "BTC/USDT",
  "requestedQuantity": "0.0250000000",
  "idempotencyKey": "b1f2..."
}
```

- Same auth/rate-limit bucket (`tradingBotWrite`) as the orders route.
- No `signalId` field exists on this request, and this route never imports
  or calls anything from `lib/trading-signals` (no `generateSignals`, no
  `buildSignalFromCandles`) — closing a position is unconditionally
  independent of any signal, **including a SHORT signal**: there is no code
  path by which receiving or observing a SHORT signal is required, checked,
  or even consulted before a close is allowed.
- `symbol` is a **selector into the user's own tracked positions**, not
  client-trusted pricing/sizing data: the server looks it up in that user's
  `MockAccount.positions` map and rejects `NO_OPEN_POSITION` if the user
  holds none for that symbol. Available quantity (for the
  `INSUFFICIENT_POSITION` check) and execution price (§6, from a fresh
  candle close) are always server-derived — the request never carries either.
- Full pipeline, same as the orders route: `requireUser()` → body validation
  → `withUserLock(userId, ...)` → idempotency-cache check → `StubRiskEngine`
  rule 3 (quantity ≤ held) → `MockBroker` execution (candle-freshness check,
  price lookup, fee/P&L math, mutation) → result recorded under the
  idempotency key → `OrderResultDTO` response. No step is skipped or
  short-circuited for this route relative to the orders route.
- 400 malformed body. 200 → `OrderResultDTO`
  (`INSUFFICIENT_POSITION`/`NO_OPEN_POSITION`/`STALE_CANDLE_DATA`/`FILLED`).
  401/429 as above.

## 10. Page behavior (`app/trading-bot/page.tsx`)

- Route added to `middleware.ts` `isProtectedPage` (`"/trading-bot(.*)"`),
  identical pattern to `/portfolio`.
- Fetches existing `GET /api/trading-signals` unmodified; displays a
  persistent "Paper / Simulated — not real trading" banner (no mode toggle
  exists to turn this off, per §13).
- For each `LONG` signal: quantity input + "Place Mock Order" button. On
  submit, the client generates `idempotencyKey` via `crypto.randomUUID()`
  once per submission and reuses the *same* key if the user retries a failed
  network request for that same click (not regenerated on retry), so retries
  are naturally idempotent. Sends exactly `{ signalId, observedGeneratedAt,
  requestedQuantity, idempotencyKey }` — never price, stop-loss, or side.
- `SHORT` signals render as visibly disabled ("not supported in Phase 1"),
  no order control.
- Account panel from `GET /api/trading-bot/account`; each open position has
  a "Close" control wired to the close-position route. Its quantity input
  **defaults to the full held position quantity** (a one-click full close is
  the primary path); the value is editable down for a partial close, but
  Phase 1 deliberately does not build an advanced order ticket — no limit
  price, no order-type selector, no time-in-force, no partial-fill
  simulation. This control never reads or depends on any signal (SHORT or
  otherwise) to become available — it is enabled whenever the user holds a
  position, full stop.
- All monetary values rendered from the string DTOs directly (formatted for
  display only in the component; no arithmetic performed client-side, no
  `@prisma/client` import in any client component).

## 11. Safety boundary

- `lib/trading-bot/**` may import `lib/trading-signals`'s **types, config,
  and pure functions only** (`buildSignalFromCandles`, `TradingSignal`,
  `Timeframe`, `SUPPORTED_SYMBOLS`, `SYMBOL_WHITELIST`, `DEFAULT_TIMEFRAME`,
  `CANDLE_LIMIT`) and `lib/market-data/candles`'s `getCandles` (also
  keyless/public). It must never import `lib/exchanges/mexc.ts` or reference
  `MEXC_API_KEY`/`MEXC_API_SECRET`.
- No broker credential field, connection settings, live-mode flag/toggle, or
  environment variable for a real broker exists anywhere in Phase 1 code —
  not even a disabled one. The concept does not exist yet, so it cannot be
  misconfigured on.
- No cron job, background interval, queue, or automated loop touches this
  module. Every mutation is a direct, synchronous result of an authenticated
  user's HTTP request.
- A dedicated safety test (mirroring the existing
  `tests/trading-signals-safety.test.ts` pattern) statically scans
  `lib/trading-bot/**` and `app/api/trading-bot/**` source text and fails the
  suite if it finds: an import of `lib/exchanges/*`, the literal strings
  `MEXC_API_KEY`/`MEXC_API_SECRET`, a fetch to any host other than the
  existing keyless klines host already used by `lib/market-data/candles.ts`,
  or any reference to a "live" mode identifier.

## 12. Rate limiting

`lib/api/rate-limit.ts`'s `RateLimitBucket` union gains two members,
additively (same pattern as the existing `signalsRead` addition):

```ts
export type RateLimitBucket =
  | "write" | "providerRead" | "agentsRead" | "signalsRead"
  | "tradingBotRead" | "tradingBotWrite";
```

- `tradingBotRead`: default 60/window, env `RATE_LIMIT_TRADING_BOT_READ_MAX`.
- `tradingBotWrite`: default 20/window, env
  `RATE_LIMIT_TRADING_BOT_WRITE_MAX`. Lower than the generic `write` bucket
  default (30) because order placement is more sensitive than typical writes.

Both documented in `.env.example` as optional, sane-default, following the
existing convention exactly.

## 13. Explicitly not present in Phase 1

No DB persistence · no full risk rule set · no backtesting · no 2FA/live-mode
gating · no broker connection settings UI · no audit log · no bot
start/stop/automation · no limit orders/partial fills/slippage · no
margin/leverage/short-selling · no configurable/reset-able starting balance.
Each is named in a later phase of the original 7-phase plan and is not
reintroduced here under a different name.

## 14. Testing plan

Unit (`lib/trading-bot/`, Vitest, no network — deterministic fixtures like
the existing `trading-signals-engine.test.ts`):

1. `MockBroker` BUY: notional/fee math, average-entry-price update across
   repeat buys, exact quantity precision preserved.
2. `MockBroker` BUY: insufficient-funds rejection when `notional + fee >
   cashBalance` (not a raw quantity/equity comparison).
3. `MockBroker` SELL: reduces position, computes `realizedPnl` correctly
   (including the fee deduction), removes a fully-closed position.
4. `MockBroker` SELL: rejects when `requestedQuantity` exceeds held quantity
   (`INSUFFICIENT_POSITION`) and when no position exists
   (`NO_OPEN_POSITION`) — no cash/position mutation occurs on rejection.
5. `MockBroker` long-only invariant: no path exists to open a negative
   position (attempted "naked" SELL is rejected, never fulfilled).
6. `StubRiskEngine`: each of its four rules individually (§5.5), both accept
   and reject cases.
7. Idempotency: duplicate `idempotencyKey` + same user → second call returns
   the identical stored result (`idempotent: true`), no second `Fill`, no
   change to cash/position after the second call.
8. Per-user isolation: two `userId`s using the *same* `idempotencyKey` and
   symbol do not interact — independent balances, positions, and
   idempotency records.
9. Malformed/invalid decimal input: negative, zero, `"NaN"`, `"Infinity"`,
   exponential notation (`"1e5"`), multiple decimal points, empty string,
   over-precision (`> 10dp`), and non-string JSON types (number, null,
   object) are all rejected by `parseQuantityInput` before reaching any
   broker/risk logic.
10. Stale signal-instance rejection: `observedGeneratedAt` older than
    `SIGNAL_FRESHNESS_WINDOW_MS` (5 min) → `STALE_SIGNAL`, no order created —
    using a fixture whose *candle* data is fresh, isolating this check from
    candle freshness.
11. Unsupported SHORT rejection: a signal fixture returning `SHORT` →
    `UNSUPPORTED_SHORT`, no `TradeIntent` constructed (assert via a spy that
    `MockBroker.placeOrder` is never called).
12. Concurrent duplicate submission: fire two `placeOrder` calls with the
    same user + idempotency key via `Promise.all`; assert exactly one `Fill`
    exists afterward and both calls resolve to the same `orderId`.
13. API contract: response bodies from all four routes assert
    `typeof field === "string"` for every monetary/quantity field — never
    `"number"`.
14. Safety test (§11): static scan asserts no forbidden import/string/host is
    reachable from `lib/trading-bot/**` or `app/api/trading-bot/**`.
15. Route-level authorization: call each route handler directly (bypassing
    middleware, as Vitest route tests already do elsewhere in this repo) with
    no session and assert 401 — proving `requireUser()` inside the handler is
    the actual enforcement point, not a middleware-only assumption.
16. Unrecognized `signalId`: a symbol/timeframe outside `SUPPORTED_SYMBOLS`/
    `DEFAULT_TIMEFRAME` → `UNRECOGNIZED_SIGNAL`.
17. Pipeline-integrity: assert (via spies on `Strategy`/`RiskEngine`) that
    the orders route always calls them in order, and that a `RiskEngine`
    rejection results in **zero** calls to `MockBroker.placeOrder`. The same
    assertion repeated for the close-position route against
    `StubRiskEngine`/`MockBroker` (it has no `Strategy` call to spy on).
18. Candle-staleness rejection (BUY): a fixture with a *fresh* signal
    instance (`observedGeneratedAt` within the 5-minute window) but a last
    candle `openTime` older than `TIMEFRAME_DURATION_MS["4h"] +
    CANDLE_STALENESS_GRACE_MS` → `STALE_CANDLE_DATA`, no order created. Confirms
    this check fires independently of `STALE_SIGNAL`.
19. Old-candle-but-valid-signal is NOT rejected (BUY): a 4h signal whose last
    candle is, e.g., 3 hours old (comfortably inside the ~4h05m ceiling) and
    whose `observedGeneratedAt` is within 5 minutes → proceeds to `FILLED`,
    proving a valid 4h signal is never rejected merely for being "more than
    five minutes old" by candle-clock time.
20. Candle-staleness rejection (SELL): same rule, exercised on the
    close-position path using its own `getCandles` call.
21. Close Position never touches the signal engine: assert (via a module
    mock/spy on `lib/trading-signals`) that `generateSignals` and
    `buildSignalFromCandles` are called **zero** times anywhere in the
    close-position route's execution, for both a SHORT-signal fixture and a
    no-signal-available fixture — closing is unconditionally independent of
    signal state.
22. Close Position full-close-by-default: a close request with
    `requestedQuantity` equal to the full held quantity removes the position
    from `MockAccount.positions` entirely and credits `realizedPnl`
    correctly; a smaller `requestedQuantity` reduces `quantity` while
    leaving `avgEntryPrice` on the remainder unchanged (standard
    average-cost partial-close accounting).
23. Naked/negative-position rejection: a SELL for a symbol with no existing
    position, and a SELL whose quantity exceeds the held quantity, both
    reject before any mutation (`NO_OPEN_POSITION` /
    `INSUFFICIENT_POSITION`) — no position ever goes negative.

## 15. Resolved decisions (superseding the prior "open questions")

All four items previously flagged for confirmation were reviewed and
approved on 2026-07-14:

1. **Starting paper balance:** fixed at `10,000.00 USDT`, held as the named
   constant `PAPER_STARTING_BALANCE_USDT` (§6) — changeable later without
   touching execution logic. No reset/configuration UI in Phase 1 (Phase 4).
2. **Mock fee rate:** flat `0.1%` (`MOCK_FEE_RATE = 0.001`), applied
   identically to BUY notional and SELL proceeds via the single shared
   `pricing.ts` constant reference — used by `StubRiskEngine`, `MockBroker`,
   account/equity calculations, and every test fixture.
3. **Signal freshness:** the 5-minute `SIGNAL_FRESHNESS_WINDOW_MS` ceiling on
   signal-*instance* age is approved, and is explicitly independent of a
   separate timeframe-aware candle-*data* freshness rule
   (`TIMEFRAME_DURATION_MS[timeframe] + CANDLE_STALENESS_GRACE_MS`, §6). Both
   are validated on every BUY; the SELL path validates candle freshness only
   (it has no signal instance to age-check).
4. **Close Position scope:** approved as narrowly specified in §3, §6, §9,
   and §10 — reduce/close-only, long-only, server-derived
   symbol-as-selector/quantity/price, full pipeline enforcement, default-to-
   full-close UI with no advanced order ticket, and no dependency on any
   signal (including SHORT).

No open questions remain for Phase 1.
