# AI Trading Bot — Phase 4: Persistent Paper Trading & Full Risk Engine — Implementation Plan

**Status: Not started.** Implements
`docs/superpowers/specs/2026-07-17-trading-bot-phase4-persistent-paper-trading-design.md`
(Approved for implementation planning, 2026-07-17). Every section reference below (`§N`)
refers to that design document.

Do not mark Phase 4 Accepted anywhere (this plan, `FEATURE_REGISTRY.md`, `ROADMAP.md`) until
the repository owner reports the Checkpoint 10 manual authenticated acceptance checklist passed.

## Architecture note — why Checkpoints 5/6 precede Checkpoint 7

Checkpoint 5 (execution/accounting) and Checkpoint 6 (Risk Engine) are built and fully tested
**before** Checkpoint 7 (the real signal adapter and market-data valuation fetcher) exists. This
is possible without circularity because every function built in Checkpoints 5 and 6 takes its
market data as an **already-resolved plain-data input** (a `ValuationSnapshot`, a `SourceSignal`,
an execution price) — never fetches it itself. Checkpoint 5's fill-writing functions accept a
pre-resolved execution price; Checkpoint 6's risk-rule evaluator accepts a pre-assembled
`RiskEvaluationContext` (account, positions, day-state, risk profile, valuation snapshot, all
plain data). Both are fully unit/integration-testable with hand-constructed fixtures standing in
for real market data. Checkpoint 7 then builds the actual I/O layer (signal re-derivation, mark
fetching, provider deadline) that produces those same plain-data shapes for real. Checkpoint 8 is
the first place all three are wired together into an actual HTTP request pipeline. No task in
Checkpoints 5 or 6 imports anything from Checkpoint 7.

## Global rules enforced across every checkpoint

- All monetary and quantity arithmetic uses `Prisma.Decimal` via `D8` (imported from
  `lib/backtest/decimal.ts`, never reimplemented). Plain JavaScript numbers are used only for
  true integer counts (`maxOpenPositions`, `cooldownAfterLosses`, `orderWindowMinutes`, etc.) —
  never for money, price, or quantity. Every hand-calculated fixture test in this plan exists
  specifically to catch any drift toward float math (a classic `0.1 + 0.2` error would fail a
  fixture immediately).
- Every real-Postgres integration test (`tests/integration/**`) uses `TEST_DATABASE_URL` /
  `TEST_DIRECT_DATABASE_URL` exclusively, via a dedicated `PrismaClient` constructed by the
  Checkpoint 2 harness — never the app's `lib/db.ts` singleton (which reads `DATABASE_URL`).
  `tests/integration/**` is excluded from the default `npm test` glob and run only via
  `npm run test:integration`, which is a mandatory, separately-run acceptance gate (§21, §24).
- No `prisma.$transaction` callback in Checkpoints 4–8 performs network I/O. Market-data and
  signal fetches happen strictly before a transaction opens (spec §7 step 8, before step 9); this
  is enforced structurally because the fetcher functions built in Checkpoint 7 never accept a
  Prisma transaction client as a parameter.
- No replay path (Checkpoint 4's idempotency resolver, exercised from Checkpoint 8's routes)
  calls a Checkpoint 7 fetch function — Stage 1 idempotency resolution (spec §7 steps 4–5) always
  runs and returns before any provider call (step 8).
- `lib/trading-bot/**` and the four Phase 1 route files are never modified or deleted before
  Checkpoint 9's final task (9.7), and only after 9.1–9.6 are verified green.

---

## Checkpoint 1 — Domain types, constants, Decimal rules, DTOs, error codes, canonical payload hashing

Pure logic only. No Prisma import, no I/O, no database.

### Task 1.1 — Constants, domain types, reject-code taxonomy
- **Files:** `pixel-office/lib/paper-trading/config.ts`, `pixel-office/lib/paper-trading/types.ts`, `pixel-office/lib/paper-trading/errors.ts`
- **Test file:** `pixel-office/tests/paper-trading-errors.test.ts`
- **Command:** `npx vitest run tests/paper-trading-errors.test.ts`
- **Expected first failure:** `Cannot find module '@/lib/paper-trading/errors'`
- **Implementation:** `config.ts` — `PAPER_STARTING_BALANCE`, `PAPER_FEE_RATE`, `PAPER_SPREAD_BPS`,
  `PAPER_SLIPPAGE_BPS`, `DEFAULT_RISK_PROFILE` (the §5.1/§4.2 default values). `types.ts` — the 22
  reject codes from §11/§12/§7 (`GENERATION_MISMATCH`, `EMERGENCY_STOP_ACTIVE`,
  `STALE_CANDLE_DATA`, `RISK_UNCONFIRMED`, `NON_POSITIVE_EQUITY`, `MISSING_STOP_LOSS`,
  `INVALID_STOP_LOSS`, `POSITION_ALREADY_OPEN`, `MAX_RISK_PER_TRADE`, `MAX_POSITION_SIZE`,
  `MAX_TOTAL_EXPOSURE`, `MAX_OPEN_POSITIONS`, `DAILY_LOSS_LIMIT`, `MAX_DRAWDOWN`,
  `MAX_ORDER_FREQUENCY`, `COOLDOWN_ACTIVE`, `INSUFFICIENT_FUNDS`, `NO_OPEN_POSITION`,
  `INSUFFICIENT_POSITION`, `INVALID_QUANTITY_PRECISION`, `PROVIDER_UNAVAILABLE`); `CommandType`,
  `SnapshotCompleteness` mirrored from the Prisma enums as plain TS unions so pure-logic code
  never needs `@prisma/client` (Checkpoint 6's rule evaluator stays DB-import-free). `errors.ts`
  — `defaultReason(code)` map, one string per code, ported from the pattern in
  `lib/trading-bot/errors.ts`.
- **Verification:** `npx vitest run tests/paper-trading-errors.test.ts` green (every code has a
  non-empty, unique reason string; no code is missing from the map — asserted by iterating the
  reject-code union).
- **Commit:** `feat(paper-trading): add Phase 4 constants, domain types, and reject-code reasons`

### Task 1.2 — Decimal precision guard and canonical pricing/cost-basis formulas
- **Files:** `pixel-office/lib/paper-trading/decimal.ts`, `pixel-office/lib/paper-trading/pricing.ts`
- **Test files:** `pixel-office/tests/paper-trading-decimal.test.ts`, `pixel-office/tests/paper-trading-pricing.test.ts`
- **Command:** `npx vitest run tests/paper-trading-decimal.test.ts tests/paper-trading-pricing.test.ts`
- **Expected first failure:** `Cannot find module '@/lib/paper-trading/pricing'`
- **Implementation:** `decimal.ts` re-exports `D8` from `lib/backtest/decimal.ts` (no
  reimplementation) and adds `validateQuantityPrecision(raw: string)` — rejects any string with
  more than 8 fractional digits, returns `INVALID_QUANTITY_PRECISION` rather than rounding.
  `pricing.ts` re-exports `askPrice`/`bidPrice` from `lib/backtest/fills.ts` and adds Phase-4-only
  pure functions per §8/§9: `entryNotional`, `entryFee`, `entryCost`, `newPositionLiquidationValue`,
  `exitNotional`, `exitFee`, `exitProceeds`, `allocatedCostBasisPartial`,
  `allocatedCostBasisFull` (exact assignment, no ratio division), `realizedPnl`,
  `remainingCostBasis`, `riskAmount` (§8's `max(0, entryCost − netExitProceedsAtStop)`), `riskPct`.
- **Verification:** hand-calculated fixtures — e.g. `quantity=1.00000000`, `referenceMark=50000`,
  `spreadBps=5`, `slippageBps=5`, `feeRate=0.001` → assert `entryExecutionPrice`, `entryNotional`,
  `entryFee`, `entryCost` match manually computed values to 8dp exactly; a partial-close fixture
  (`previousCostBasis=30000`, `previousQuantity=1.0`, `closedQuantity=0.4`) → assert
  `allocatedCostBasis`, `realizedPnl`, `remainingCostBasis`; a full-close fixture → assert
  `remainingCostBasis == 0` exactly (not merely close to zero). A parity fixture: compute
  `riskAmount` pre-trade for a hypothetical stop hit, then compute an actual exit fill at exactly
  the stop price, assert the two loss figures are bit-identical `Decimal` values (§8). Quantity
  precision: `"1.12345678"` accepted, `"1.123456789"` rejected.
- **Commit:** `feat(paper-trading): add Decimal precision guard and canonical pricing formulas`

### Task 1.3 — DTO shapes and decimal-string serialization
- **Files:** `pixel-office/lib/paper-trading/dto.ts`, `pixel-office/lib/paper-trading/serialize.ts`
- **Test file:** `pixel-office/tests/paper-trading-serialize.test.ts`
- **Command:** `npx vitest run tests/paper-trading-serialize.test.ts`
- **Expected first failure:** `Cannot find module '@/lib/paper-trading/serialize'`
- **Implementation:** `dto.ts` — TypeScript interfaces for `AccountDTO`, `PositionDTO`,
  `OrderResponseDTO`, `RiskProfileDTO`, `JournalEntryDTO`, `AuditEntryDTO`,
  `EmergencyStopResponseDTO`, `ResetResponseDTO`, exactly per §15/§10 nullability rules
  (`cashBalance`/`observedPeakEquity`/`dailyRealizedPnl` always-known strings;
  `equity`/`totalExposure`/`observedDrawdownPct`/`dailyLossPct` nullable). `serialize.ts` —
  `toDecimalString(d, dp=8)` (fixed-point, never exponential notation — same rationale as
  `lib/backtest/decimal.ts`'s `toFixedString`), `parseDecimalInput` (validates + parses a request
  string into `Prisma.Decimal`, delegating precision checks to Task 1.2's guard).
- **Verification:** round-trip tests (`Decimal → string → Decimal` equality), an
  exponential-notation regression fixture (a very small Decimal like `0.00000001` serializes as
  `"0.00000001"`, never `"1e-8"`), `dailyRealizedPnl` defaults to `"0.00000000"` when passed
  `null`/`undefined` input representing "no day-state row yet" (§15).
- **Commit:** `feat(paper-trading): add DTO shapes and decimal-string serialization helpers`

### Task 1.4 — Canonical payload construction and idempotency hashing
- **Files:** `pixel-office/lib/paper-trading/idempotency-hash.ts`
- **Test file:** `pixel-office/tests/paper-trading-idempotency-hash.test.ts`
- **Command:** `npx vitest run tests/paper-trading-idempotency-hash.test.ts`
- **Expected first failure:** `Cannot find module '@/lib/paper-trading/idempotency-hash'`
- **Implementation:** `canonicalOrderPayload`, `canonicalResetPayload`, `canonicalStopPayload`
  (§13/§7 step 4) — sorted-key JSON, 8dp fixed-string Decimal normalization, UTF-8, no whitespace;
  `hashPayload(payload) → { payloadHash: sha256Hex, hashVersion: "v1" }` using Node's `crypto`.
- **Verification:** identical logical payload built with keys in different object-literal order
  produces the identical hash; changing any one field (side, symbol, quantity, generation, reason)
  changes the hash; the same quantity expressed as `"1.5"` vs `"1.50000000"` normalizes to the
  identical hash (proving 8dp normalization, not raw-string hashing).
- **Commit:** `feat(paper-trading): add canonical payload construction and idempotency hashing`

**Checkpoint 1 gate:** `npx tsc --noEmit` clean, `npx vitest run tests/paper-trading-*.test.ts`
all green, `npm run lint` clean. No Prisma import anywhere in `lib/paper-trading/` yet.

---

## Checkpoint 2 — Real-Postgres isolated integration-test harness and safety guards

### Task 2.1 — `test:integration` script and vitest config split
- **Files:** `pixel-office/package.json` (add `"test:integration": "vitest run tests/integration"`),
  `pixel-office/vitest.integration.config.ts` (extends the base config, `include: ["tests/integration/**/*.test.ts"]`, excluded from the default `vitest.config.ts` include glob)
- **Test file:** none (config-only); verified by Task 2.2's smoke test
- **Command:** `npm run test:integration` (expected to fail: no test files match yet)
- **Implementation:** exactly mirrors the existing `test:live` opt-in pattern
  (`package.json`/`vitest.config.ts` already exclude `tests/live/**` from the default run).
- **Verification:** `npm test` (default) does not pick up anything under `tests/integration/`;
  `npm run test:integration` runs (and reports "no tests found" until Task 2.2 lands).
- **Commit:** `chore(paper-trading): add separate test:integration command`

### Task 2.2 — Harness: env guards, per-run schema lifecycle
- **Files:** `pixel-office/tests/integration/harness.ts`
- **Test file:** `pixel-office/tests/integration/harness.test.ts`
- **Command:** `TEST_DATABASE_URL=postgresql://... npm run test:integration -- harness.test.ts`
- **Expected first failure:** `Cannot find module './harness'`
- **Implementation:** `createIsolatedSchema()` — throws immediately if `TEST_DATABASE_URL` is
  unset; throws if `TEST_DATABASE_URL` resolves (host+port+database, credentials stripped) to the
  same database as `DATABASE_URL`; generates `schemaName = "test_" + randomUUID().replace(/-/g,"")`;
  issues `CREATE SCHEMA "<schemaName>"` via a raw admin connection; verifies via
  `information_schema.schemata` that the schema now exists and was not present before this call
  (the "not created by this run" guard); returns `{ schemaName, testDatabaseUrl, testDirectUrl }`
  with `?schema=` appended to both. `dropIsolatedSchema(schemaName)` — `DROP SCHEMA "<schemaName>"
  CASCADE`, called unconditionally from a `finally` in every consumer. Credentials are never
  logged — any diagnostic output strips the password from the connection string first.
- **Verification:** (a) unset `TEST_DATABASE_URL` → harness throws before any SQL runs; (b) set
  `TEST_DATABASE_URL` equal to `DATABASE_URL` → harness throws; (c) happy path — create, assert
  present in `information_schema.schemata`, drop, assert absent; (d) two concurrent
  `createIsolatedSchema()` calls produce two distinct schema names, both independently torn down.
- **Commit:** `test(paper-trading): add real-Postgres isolated-schema harness with safety guards`

### Task 2.3 — Migration-apply wiring, tested against the existing Portfolio migrations
- **Files:** `pixel-office/tests/integration/harness.ts` (add `applyMigrations`)
- **Test file:** `pixel-office/tests/integration/harness-migrate.test.ts`
- **Command:** `npm run test:integration -- harness-migrate.test.ts`
- **Expected first failure:** `harness.applyMigrations is not a function`
- **Implementation:** `applyMigrations(directUrl)` shells out to
  `npx prisma migrate deploy --schema=prisma/schema.prisma` with `DIRECT_URL`/`DATABASE_URL`
  pointed at the isolated-schema connection strings via environment overrides for the child
  process only (never mutating `process.env` for the parent test process).
- **Verification:** create an isolated schema, run `applyMigrations`, assert (via a raw query
  against `information_schema.tables` in that schema) that the Portfolio module's existing tables
  (`users`, `portfolios`, `transactions`, `holdings`, `assets`, `price_snapshots`,
  `dca_milestones`, `portfolio_value_snapshots`) all exist — this exercises the real, current
  migration history (`0_init`, `1_perf_and_tenant_uniqueness`) end-to-end without needing Phase
  4's migration to exist yet. Teardown drops the schema.
- **Commit:** `test(paper-trading): wire real migration apply into the isolated-schema harness`

### Task 2.4 — Per-run isolated `PrismaClient` factory
- **Files:** `pixel-office/tests/integration/harness.ts` (add `createTestPrismaClient`)
- **Test file:** `pixel-office/tests/integration/harness-client.test.ts`
- **Command:** `npm run test:integration -- harness-client.test.ts`
- **Implementation:** `createTestPrismaClient(schemaUrl)` returns a `new PrismaClient({ datasources: { db: { url: schemaUrl } } })` — a fresh client instance per test run, never the app's `lib/db.ts` singleton.
- **Verification:** the test client's connection targets the isolated schema (asserted via
  `SELECT current_schema()`), and is fully independent of `lib/db.ts` (asserted by confirming
  `lib/db.ts` is never imported in this file — a static import-scan assertion in the test itself).
- **Commit:** `test(paper-trading): add isolated-schema PrismaClient factory for integration tests`

**Checkpoint 2 gate:** `npm run test:integration` (with `TEST_DATABASE_URL` set to a real disposable
Postgres) green; `npm test` (default) unaffected and still excludes `tests/integration/**`.

---

## Checkpoint 3 — Prisma models, migration, raw SQL, composite FKs, append-only triggers

### Task 3.1 — Prisma schema authoring
- **Files:** `pixel-office/prisma/schema.prisma` (append §4.1/§4.2 in full: 9 enums, 11 models, the
  two additive `User` back-relations)
- **Command:** `npx prisma validate && npx prisma generate`
- **Expected first failure (before edit):** N/A — this task starts from a clean schema; the
  "first failure" is `npx prisma validate` failing on any subsequent task that references a
  Phase 4 model before this task lands.
- **Verification:** `npx prisma validate` clean; `npx prisma generate` produces client types for
  all 11 new models with no `any`; `npx tsc --noEmit` across the repo still clean (no naming
  collision with existing Portfolio types).
- **Commit:** `feat(paper-trading): add Phase 4 Prisma schema (11 models, 9 enums)`

### Task 3.2 — Migration generation and raw SQL additions
- **Files:** `pixel-office/prisma/migrations/<timestamp>_phase4_paper_trading/migration.sql`
- **Command:** `npx prisma migrate dev --name phase4_paper_trading --create-only`, then hand-edit
  the generated file to append §4.3's partial unique index and CHECK constraints and confirm
  §4.4's composite FKs were auto-generated (they are, from the Prisma relation declarations) and
  §4.5's append-only trigger function + six triggers, then `npx prisma migrate dev` (applies
  locally to the developer's `DATABASE_URL`).
- **Verification:** `npx prisma migrate status` reports the migration applied cleanly; a fresh
  `npx prisma db pull`-style diff shows zero drift between `schema.prisma` and the actual
  database (confirms the hand-edited raw SQL didn't silently diverge from what Prisma expects to
  exist).
- **Commit:** `feat(paper-trading): add Phase 4 migration with partial index, CHECK constraints, and append-only triggers`

### Task 3.3 — Real-Postgres constraint tests
- **Files:** `pixel-office/tests/integration/paper-trading-schema-constraints.test.ts`
- **Command:** `npm run test:integration -- paper-trading-schema-constraints.test.ts`
- **Expected first failure:** every assertion fails until the migration (Task 3.2) is applied to
  the isolated schema inside this test's own setup (via Checkpoint 2's `applyMigrations`).
- **Implementation of test cases:** one active account per user (insert two `ACTIVE` rows for the
  same `userId` → second raises `23505` on the partial unique index); every named CHECK from
  §4.3 (one raw insert/update per constraint, e.g. `cash_balance = -1` → `23514`); the two
  `PaperTradeJournal` composite-integrity CHECKs (`related_order_id` set without
  `related_order_account_id`, and vice versa → `23514`; `related_order_account_id` pointing at a
  different account than `paper_account_id` → `23514`); the `PaperFill` composite FK
  (`(orderId, paperAccountId)` referencing an order that belongs to a different account →
  `23503`); `FILLED`-has-exactly-one-fill/`REJECTED`-has-none (seed both kinds, `LEFT JOIN` proves
  the invariant, then a raw insert of a second fill for an existing `orderId` → `23505` on
  `PaperFill.orderId @unique`).
- **Verification:** every sub-test asserts the exact Postgres error code, not merely "an error was
  thrown."
- **Commit:** `test(paper-trading): add real-Postgres constraint and composite-FK tests`

### Task 3.4 — Append-only trigger tests and constraint introspection
- **Files:** `pixel-office/tests/integration/paper-trading-append-only.test.ts`,
  `pixel-office/tests/integration/paper-trading-introspection.test.ts`
- **Command:** `npm run test:integration -- paper-trading-append-only.test.ts paper-trading-introspection.test.ts`
- **Implementation:** for each of the six append-only tables (`paper_orders`, `paper_fills`,
  `paper_commands`, `paper_equity_snapshots`, `paper_trade_journal`, `paper_audit_log`) — a direct
  `UPDATE` and a direct `DELETE` against an existing seeded row, each asserted to raise the
  trigger exception; a separate case deletes the parent `PaperAccount` while any of these child
  rows exist → `23503` (the pre-existing `Restrict` behavior, tested here alongside the triggers
  for completeness). Introspection test queries `information_schema.check_constraints` and
  `information_schema.triggers` and asserts every named constraint/trigger from §4.3/§4.5 exists
  by name.
- **Verification:** 6 tables × 2 operations = 12 trigger assertions, plus the parent-delete case,
  plus the introspection list, all green.
- **Commit:** `test(paper-trading): add append-only trigger and constraint introspection tests`

**Checkpoint 3 gate:** `npm run test:integration` green including all of Checkpoint 3's new files;
`npx prisma validate` clean; no application code outside `prisma/` touched yet.

---

## Checkpoint 4 — Bootstrap, repositories, lock ordering, Serializable wrapper, two-stage idempotency

### Task 4.1 — Serializable transaction wrapper with bounded retry
- **Files:** `pixel-office/lib/paper-trading/db-transaction.ts`
- **Test file:** `pixel-office/tests/paper-trading-db-transaction.test.ts` (pure unit test, mocked Prisma client — no real DB needed for the retry-loop logic itself)
- **Command:** `npx vitest run tests/paper-trading-db-transaction.test.ts`
- **Expected first failure:** `Cannot find module '@/lib/paper-trading/db-transaction'`
- **Implementation:** `withSerializableRetry(prisma, fn, { maxAttempts: 3 })` — calls
  `prisma.$transaction(fn, { isolationLevel: "Serializable" })`; on a caught error whose
  `.code === "P2034"` (Prisma's mapping for a serialization/deadlock failure) or whose underlying
  Postgres code is `40001`/`40P01`, retries with jittered backoff (`20ms, 60ms, 150ms` + random
  jitter) up to `maxAttempts`; any other error propagates immediately, unretried.
- **Verification:** a mocked `$transaction` that throws a `40001`-coded error twice then succeeds
  → the wrapper retries exactly twice and returns the success; a mock that always throws `40001`
  → exhausts 3 attempts then rejects with a distinct `SerializationRetryExhausted` error; a mock
  that throws a plain validation error → propagates immediately, zero retries (proving the
  retry-scope restriction).
- **Commit:** `feat(paper-trading): add Serializable transaction wrapper with bounded retry`

### Task 4.2 — Concurrency-safe bootstrap service
- **Files:** `pixel-office/lib/paper-trading/bootstrap.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-bootstrap.test.ts`
- **Command:** `npm run test:integration -- paper-trading-bootstrap.test.ts`
- **Expected first failure:** `Cannot find module '@/lib/paper-trading/bootstrap'`
- **Implementation:** `getOrCreateActivePaperAccount(prisma, userId)` exactly per §5.2 — lock the
  `User` row, find-or-create generation 1 with `RiskProfile` defaults, inactive
  `EmergencyStopState`, and a `BOOTSTRAP`-triggered `COMPLETE` `PaperEquitySnapshot`, all in one
  transaction using Task 4.1's wrapper.
- **Verification:** single-call happy path creates all four rows atomically; a second call for the
  same user returns the existing account, creates nothing new; **the concurrent test**: `N=10`
  parallel calls for the same brand-new `userId` (via Task 2.4's isolated client, `Promise.all`)
  → exactly one `generation=1` `PaperAccount` row exists afterward, and every call's return value
  describes that same `paperAccountId`.
- **Commit:** `feat(paper-trading): add concurrency-safe account bootstrap service`

### Task 4.3 — Account resolution repository (userId-scoped, includes archived)
- **Files:** `pixel-office/lib/paper-trading/repository.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-repository.test.ts`
- **Command:** `npm run test:integration -- paper-trading-repository.test.ts`
- **Implementation:** `resolveAddressedAccount(prisma, userId, generation)` — plain unlocked
  `findFirst` scoped by `userId AND generation`, including `ARCHIVED` rows (§7 step 3);
  `lockActiveAccount(tx, userId)` — raw `SELECT ... WHERE user_id=$1 AND status='ACTIVE' FOR
  UPDATE` inside a transaction; `listOpenPositions(prisma, paperAccountId)`.
- **Verification:** resolving a generation belonging to a different `userId` returns `null` (the
  structural cross-user protection — asserted directly, not merely "trust the query"); resolving
  an `ARCHIVED` generation succeeds when it belongs to the caller's own `userId`; two concurrent
  callers both attempting `lockActiveAccount` for the same user — the second's query blocks until
  the first's transaction commits (asserted via timing/an intentional delay inside the first
  transaction).
- **Commit:** `feat(paper-trading): add userId-scoped account resolution repository`

### Task 4.4 — Two-stage idempotency resolver
- **Files:** `pixel-office/lib/paper-trading/idempotency-resolver.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-idempotency-resolver.test.ts`
- **Command:** `npm run test:integration -- paper-trading-idempotency-resolver.test.ts`
- **Implementation:** `resolveIdempotency(prismaOrTx, paperAccountId, idempotencyKey, payloadHash, commandType?)`
  — generic over `PaperOrder` (no `commandType`) and `PaperCommand` (with `commandType`); returns
  `{ status: "replay", result }` / `{ status: "conflict" }` / `{ status: "new" }`. Used both
  unlocked (Stage 1, §7 step 5) and inside a locked transaction (Stage 2, §7 step 9) — identical
  function, different caller context.
- **Verification:** seed a `FILLED` order with a known key+hash, call with the same key+matching
  hash → `replay` with the exact stored order+fill reconstruction (§13's field list, no live
  account data mixed in); same key+different hash → `conflict`; unknown key → `new`; the same
  three cases repeated for `PaperCommand` with each of the three `commandType` values.
- **Commit:** `feat(paper-trading): add two-stage idempotency resolver for orders and commands`

**Checkpoint 4 gate:** `npm run test:integration` green including all Checkpoint 4 files; no HTTP
route exists yet — everything here is a library-level service tested directly.

---

## Checkpoint 5 — Persistent paper execution: immutable orders/fills, cost basis, snapshots

Every function in this checkpoint takes an **already-approved** intent and an
**already-resolved** execution price as plain-data input — it does not evaluate risk (that is
Checkpoint 6) and does not fetch market data (that is Checkpoint 7).

### Task 5.1 — BUY fill writer
- **Files:** `pixel-office/lib/paper-trading/execute-buy.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-execute-buy.test.ts`
- **Command:** `npm run test:integration -- paper-trading-execute-buy.test.ts`
- **Implementation:** `writeApprovedBuy(tx, { paperAccountId, generation, symbol, quantity, referenceMark, spreadBps, slippageBps, feeRate, idempotencyKey, payloadHash, signalGeneratedAt, signalHash, entryStopLoss, entryTakeProfit })`
  — inside the caller's already-open transaction: insert `PaperOrder(FILLED)`, insert
  `PaperFill` (using Task 1.2's pricing formulas, storing `appliedFeeRate`/`appliedSpreadBps`/
  `appliedSlippageBps`), upsert `PaperPosition` (new `costBasis = entryCost`, since rule 8 already
  guarantees no pre-existing position), decrement `cashBalance`, insert
  `PaperTradeJournal(ORDER_FILLED)`, insert `PaperAuditLog(ORDER_PLACED)`.
- **Verification:** hand-calculated fixture — starting cash `10000`, `quantity=0.1`,
  `referenceMark=50000`, default spread/slippage/fee → assert the resulting `cashBalance`,
  `PaperPosition.costBasis`, and every `PaperFill` field match manual computation to 8dp exactly.
- **Commit:** `feat(paper-trading): add BUY fill writer with fee-inclusive cost basis`

### Task 5.2 — SELL fill writer (partial and full close)
- **Files:** `pixel-office/lib/paper-trading/execute-sell.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-execute-sell.test.ts`
- **Command:** `npm run test:integration -- paper-trading-execute-sell.test.ts`
- **Implementation:** `writeApprovedSell(tx, { paperAccountId, existingPosition, closedQuantity, referenceMark, spreadBps, slippageBps, feeRate, idempotencyKey, payloadHash })`
  — partial: `allocatedCostBasisPartial`, updates `PaperPosition.quantity`/`costBasis`; full:
  `allocatedCostBasisFull` (exact assignment), deletes the `PaperPosition` row; increments
  `cashBalance` by `exitProceeds`; writes `PaperOrder(FILLED)`/`PaperFill` with `realizedPnl`;
  writes journal/audit; upserts `PaperRiskDayState.dailyRealizedPnl` unconditionally (§10's Step
  A — runs regardless of whether the caller later determines this evaluation was `COMPLETE` or
  `PARTIAL`; that determination is Checkpoint 6/7's concern, not this writer's).
- **Verification:** a partial-close fixture (hand-calculated `allocatedCostBasis`, `realizedPnl`,
  `remainingCostBasis`, updated position row) and a full-close fixture (`remainingCostBasis == 0`
  exactly, position row deleted, not zeroed) — both against real Postgres. A second fixture proves
  `dailyRealizedPnl` accrues correctly across two sequential closes on the same UTC day.
- **Commit:** `feat(paper-trading): add SELL fill writer with partial/full-close cost-basis allocation`

### Task 5.3 — Equity snapshot writer
- **Files:** `pixel-office/lib/paper-trading/snapshot.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-snapshot.test.ts`
- **Command:** `npm run test:integration -- paper-trading-snapshot.test.ts`
- **Implementation:** `writeEquitySnapshot(tx, { paperAccountId, trigger, triggerId, completeness, cash, knownPositionsValue, equity, drawdownPct, missingSymbols })` — enforces at the
  application layer that `missingSymbols` (when present) is sorted and de-duplicated before
  insert (§4.3's stated application-layer half of that invariant).
- **Verification:** a `COMPLETE` snapshot round-trips with `equity`/`drawdownPct` set and
  `missingSymbols` null; a `PARTIAL` snapshot round-trips with `equity`/`drawdownPct` null and a
  non-empty sorted `missingSymbols`; an out-of-order/duplicate `missingSymbols` input is
  normalized before the insert (unit-testable without touching the DB, plus one integration
  round-trip).
- **Commit:** `feat(paper-trading): add equity-snapshot writer with completeness enforcement`

### Task 5.4 — Rejected-order writer
- **Files:** `pixel-office/lib/paper-trading/execute-reject.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-execute-reject.test.ts`
- **Command:** `npm run test:integration -- paper-trading-execute-reject.test.ts`
- **Implementation:** `writeRejectedOrder(tx, { paperAccountId, generation, side, symbol, requestedQuantity, reasonCode, reason, idempotencyKey, payloadHash, riskContext })`
  — inserts `PaperOrder(REJECTED)` only, no `PaperFill`, `PaperTradeJournal(ORDER_REJECTED)` (or
  `RISK_BREACH` per §11), `PaperAuditLog(ORDER_REJECTED)`.
- **Verification:** after calling this writer, `PaperPosition` and `PaperAccount.cashBalance` are
  provably unchanged (queried and compared byte-for-byte before/after); the constraint from Task
  3.3 (`REJECTED` requires `reasonCode`, no fill) is exercised as a positive-path confirmation
  here, not just a raw-SQL negative test.
- **Commit:** `feat(paper-trading): add rejected-order writer with zero financial mutation`

**Checkpoint 5 gate:** `npm run test:integration` green including all Checkpoint 5 files. Every
writer here is called with hand-constructed "already approved" inputs — no risk evaluation, no
market-data fetch anywhere in this checkpoint.

---

## Checkpoint 6 — Complete Risk Engine, daily state, observation, Emergency Stop, Reset

The rule evaluator (`evaluateOpen`/`evaluateClose`) is pure logic — it takes a plain-data
`RiskEvaluationContext` (already-fetched account, positions, day-state, risk profile, valuation
snapshot) and returns a verdict. It imports no `@prisma/client` types beyond `Prisma.Decimal` and
performs no I/O. A separate "assembler" (Task 6.6) does the real DB reads inside the transaction
and calls the evaluator.

### Task 6.1 — Opening rules 1–9 (structural, equity sanity, signal validity)
- **Files:** `pixel-office/lib/paper-trading/risk-engine.ts`
- **Test file:** `pixel-office/tests/paper-trading-risk-engine-open-1-9.test.ts`
- **Command:** `npx vitest run tests/paper-trading-risk-engine-open-1-9.test.ts`
- **Implementation:** `evaluateOpen(context)` implementing §11 rules 1–9 in strict order,
  first-failure-wins, against the `RiskEvaluationContext` fixture shape.
- **Verification (pure, no DB):** one test per rule's pass and fail case, plus every explicit
  boundary from §11: `riskPct == 0.5` passes (rule 9); `preTradeEquity` of exactly `0`, a
  near-zero positive value, and a (defensively-constructed) negative value (rule 5); stop below
  entry passes, stop equal to entry / above entry / zero / negative all reject `INVALID_STOP_LOSS`
  (rule 7).
- **Commit:** `feat(paper-trading): add Risk Engine opening rules 1-9 with boundary tests`

### Task 6.2 — Opening rules 10–17 (exposure, frequency, cooldown, funds)
- **Files:** `pixel-office/lib/paper-trading/risk-engine.ts` (extend `evaluateOpen`)
- **Test file:** `pixel-office/tests/paper-trading-risk-engine-open-10-17.test.ts`
- **Command:** `npx vitest run tests/paper-trading-risk-engine-open-10-17.test.ts`
- **Implementation:** rules 10–17 exactly per §9/§11 — `newPositionLiquidationValue`-based
  `MAX_POSITION_SIZE`/`MAX_TOTAL_EXPOSURE` (bid-price convention, not `entryNotional`), `MAX_OPEN_POSITIONS`,
  `DAILY_LOSS_LIMIT` (baseline read from context, established by Task 6.4 before this rule runs),
  `MAX_DRAWDOWN`, `MAX_ORDER_FREQUENCY` (fill-`executedAt`-based count, not `PaperOrder.createdAt`),
  `COOLDOWN_ACTIVE` (`mostRecentLoss.executedAt`-anchored), `INSUFFICIENT_FUNDS`.
- **Verification:** exact-equality boundary for every rule per §11's boundary-test list (rule 10/11
  exact equality passes; rule 12 `existingCount == maxOpenPositions − 1` passes, `==
  maxOpenPositions` rejects; rule 13/14 `==` rejects; rule 15 `== maxOrdersPerWindow − 1` passes,
  `== maxOrdersPerWindow` rejects; rule 16 `now == cooldownExpiry` passes; rule 17 `entryCost ==
  cashBalance` passes). A dedicated fixture proves rule 10 uses the bid-price
  `newPositionLiquidationValue`, not the ask-price `entryNotional` (two fixtures with the same
  quantity/mark but different spread/slippage would diverge between the two conventions if the
  wrong one were wired in — the test asserts against the bid-price-computed expected value).
- **Commit:** `feat(paper-trading): add Risk Engine opening rules 10-17 with boundary tests`

### Task 6.3 — Closing rules C1–C5
- **Files:** `pixel-office/lib/paper-trading/risk-engine.ts` (add `evaluateClose`)
- **Test file:** `pixel-office/tests/paper-trading-risk-engine-close.test.ts`
- **Command:** `npx vitest run tests/paper-trading-risk-engine-close.test.ts`
- **Implementation:** §12's five rules, confirming none of the opening budget rules (2, 5–16) are
  ever consulted — asserted by a fixture where the account is Emergency-Stopped and deeply over
  every risk-budget limit, yet a structurally valid close still passes `evaluateClose`.
- **Verification:** one pass/fail case per rule, plus the "Emergency Stop and budget breaches never
  block a close" fixture above.
- **Commit:** `feat(paper-trading): add Risk Engine closing rules C1-C5`

### Task 6.4 — Daily baseline and observed-peak observation step
- **Files:** `pixel-office/lib/paper-trading/observation.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-observation.test.ts`
- **Command:** `npm run test:integration -- paper-trading-observation.test.ts`
- **Implementation:** `applyValuationObservation(tx, { paperAccountId, preTradeEquity, isComplete })`
  exactly per §10 — establishes a missing baseline (never writing `baselineEquity = 0`, gated on
  `preTradeEquity > 0`), and the epilogue `observedPeakEquity = max(existingPeak, preTradeEquity)`
  update, for both outcomes.
- **Verification:** the exact test specified in §10 — no `PaperRiskDayState` row exists for today;
  a BUY passes rules 1–8 but fails rule 9 (`MAX_RISK_PER_TRADE`), i.e. rejected before reaching
  rule 13; assert the order is `REJECTED`, a day-row now exists with
  `baselineEquity = preTradeEquity`, `dailyRealizedPnl = 0`; `observedPeakEquity` reflects
  `max(priorPeak, preTradeEquity)` — tested once where this is a new high and once where it is
  not (asserting no spurious inflation). A `PARTIAL`-flagged call never touches the baseline or
  peak (asserted by a before/after row comparison).
- **Commit:** `feat(paper-trading): add daily-baseline and observed-peak-equity observation step`

### Task 6.5 — Emergency Stop and Reset state machines
- **Files:** `pixel-office/lib/paper-trading/emergency-stop.ts`, `pixel-office/lib/paper-trading/reset.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-emergency-stop-reset.test.ts`
- **Command:** `npm run test:integration -- paper-trading-emergency-stop-reset.test.ts`
- **Implementation:** `activateEmergencyStop`/`resumeEmergencyStop` (writes `EmergencyStopState` +
  `PaperCommand` with frozen `resultJson` per §13, + `PaperAuditLog`); `resetPaperAccount` — the
  full §7-step-3/§14 algorithm: resolve by `(userId, expectedGeneration)` including archived,
  Stage-1 idempotency, archive-and-create-generation-N+1 atomically, **carry the active
  `EmergencyStopState` forward unchanged** (never auto-resumed), reseed `RiskProfile` to defaults,
  reset `observedPeakEquity` to the new `startingBalance`.
- **Verification:** reset while Emergency Stop is active → new generation's `EmergencyStopState.isActive == true`, same `reason`, `resumedAt` still null; a subsequent explicit resume call is
  required to clear it (a reset alone never does); reset-replay — call reset twice with the same
  idempotency key after a *third*, different reset has since occurred — the replay still returns
  the *original* archived→new-generation pair, not a new generation and not a
  `GENERATION_MISMATCH`.
- **Commit:** `feat(paper-trading): add Emergency Stop and Reset state machines with carry-forward`

### Task 6.6 — Risk-evaluation assembler (DB-reading glue)
- **Files:** `pixel-office/lib/paper-trading/evaluate.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-evaluate.test.ts`
- **Command:** `npm run test:integration -- paper-trading-evaluate.test.ts`
- **Implementation:** `assembleOpenContext(tx, paperAccountId, valuationSnapshot)` /
  `assembleCloseContext(...)` — read the locked account, positions, risk profile, today's day
  state, order/fill history, feed Tasks 6.1–6.3's pure evaluators, and on approval call Checkpoint
  5's writers (5.1/5.2), on rejection call 5.4, always calling 6.4's observation step per §10's
  exact sequencing (established after rule 5, epilogue after all rules).
- **Verification:** full BUY-approved-and-filled integration test, full BUY-rejected-at-various-rules
  integration tests (one per rule, confirming the assembler wires context correctly end-to-end),
  full SELL-approved-and-filled integration test — all against real Postgres, still using
  hand-constructed `ValuationSnapshot` fixtures (Checkpoint 7 has not landed yet).
- **Commit:** `feat(paper-trading): add risk-evaluation assembler wiring rules to persistence`

**Checkpoint 6 gate:** `npm run test:integration` green; `npx vitest run tests/paper-trading-risk-engine-*.test.ts` (pure, fast) green; no market-data or signal-fetching code exists yet — every
test still injects a hand-built `ValuationSnapshot`.

---

## Checkpoint 7 — Signal adapter, valuation snapshot, provider deadline, circuit breaker

### Task 7.1 — Persistent signal adapter
- **Files:** `pixel-office/lib/paper-trading/strategy.ts`
- **Test file:** `pixel-office/tests/paper-trading-strategy.test.ts`
- **Command:** `npx vitest run tests/paper-trading-strategy.test.ts`
- **Implementation:** ports `lib/trading-bot/strategy.ts`'s `SignalEngineStrategy` responsibility
  (§19) — wraps the unmodified `lib/trading-signals/` engine (`buildSignalFromCandles`) to
  re-derive the canonical signal server-side. No client-supplied side, price, stop, confidence, or
  timestamp is accepted as an input to this module at all — its only input is a symbol.
- **Verification:** mocked candle fetch — a `LONG` actionable signal produces a `SourceSignal` with
  `stopLoss`/`entryZone` populated; a `WAIT`/`SHORT`/stale-data signal is rejected with the
  matching code (`NON_ACTIONABLE_SIGNAL`/`UNSUPPORTED_SHORT`/`STALE_CANDLE_DATA`), mirroring the
  Phase 1 behavior this replaces.
- **Commit:** `feat(paper-trading): add persistent signal adapter wrapping the unchanged signal engine`

### Task 7.2 — Valuation-snapshot fetcher with provider deadline
- **Files:** `pixel-office/lib/paper-trading/valuation-snapshot.ts`
- **Test file:** `pixel-office/tests/paper-trading-valuation-snapshot.test.ts`
- **Command:** `npx vitest run tests/paper-trading-valuation-snapshot.test.ts`
- **Implementation:** `fetchValuationSnapshot(orderedSymbol, heldSymbols)` — fetches fresh marks
  for `{orderedSymbol} ∪ {heldSymbols}`, bounded by `raceWithDeadline` (reused from
  `lib/api/deadline.ts`, not reimplemented). **This function's type signature accepts no Prisma
  client or transaction parameter of any kind** — it is structurally impossible to call it from
  inside a `prisma.$transaction` callback, which is how "no transaction contains network I/O" is
  enforced, not merely documented.
- **Verification:** all marks fetched fresh → `{ marks, asOf }`; one symbol's fetch fails/times out
  → that symbol is simply absent from `marks` (never fabricated), caller determines
  `COMPLETE`/`PARTIAL` from the resulting map's coverage; total-timeout exceeded → the whole call
  rejects with `PROVIDER_UNAVAILABLE`.
- **Commit:** `feat(paper-trading): add valuation-snapshot fetcher with a bounded provider deadline`

### Task 7.3 — Partial-valuation close wiring
- **Files:** `pixel-office/lib/paper-trading/evaluate.ts` (extend the close assembler from 6.6)
- **Test file:** `pixel-office/tests/integration/paper-trading-partial-valuation-close.test.ts`
- **Command:** `npm run test:integration -- paper-trading-partial-valuation-close.test.ts`
- **Implementation:** the close assembler now calls Task 7.2's real fetcher for the target symbol
  (required) and, best-effort, for every other held symbol (never blocking on failure — §10/§12).
- **Verification:** the exact scenario from §10 — mock one other-held-symbol's mark to fail while
  the target symbol's close succeeds: assert the close still fills, the resulting
  `PaperEquitySnapshot` is `PARTIAL` with `equity`/`drawdownPct` null and the failing symbol listed
  in `missingSymbols`, `observedPeakEquity` unchanged, and a
  `PaperTradeJournal(VALUATION_INCOMPLETE)` entry is present.
- **Commit:** `feat(paper-trading): wire partial-valuation close behavior into the close assembler`

### Task 7.4 — Opening-only circuit breaker
- **Files:** `pixel-office/lib/paper-trading/circuit-breaker.ts`
- **Test file:** `pixel-office/tests/paper-trading-circuit-breaker.test.ts`
- **Command:** `npx vitest run tests/paper-trading-circuit-breaker.test.ts`
- **Implementation:** an in-memory, per-instance rolling failure counter (same precedent as
  `lib/api/rate-limit.ts`'s documented per-instance caveat) — trips after 3 consecutive provider
  failures, blocks new opening evaluations for a cooldown window; `isCircuitOpenForOpen()` /
  `recordProviderResult(success)`.
- **Verification:** 3 consecutive failures trip it, a 4th opening attempt short-circuits without
  calling the fetcher; **the close path never calls `isCircuitOpenForOpen()` at all** — asserted
  by a static grep-style test scanning the close-evaluation code path for any reference to the
  circuit-breaker module, expected to find none.
- **Commit:** `feat(paper-trading): add opening-only circuit breaker for provider failures`

**Checkpoint 7 gate:** `npm run test:integration` and `npx vitest run tests/paper-trading-*.test.ts`
both green. Checkpoints 5/6's writers/evaluators are now exercised with real fetch functions in
integration tests, still with no HTTP route yet.

---

## Checkpoint 8 — Auth, CSRF, Content-Type, rate limits, routes, pagination, error mapping

### Task 8.1 — Same-origin CSRF guard
- **Files:** `pixel-office/lib/api/same-origin.ts`
- **Test file:** `pixel-office/tests/api-same-origin.test.ts`
- **Command:** `npx vitest run tests/api-same-origin.test.ts`
- **Implementation:** `assertSameOriginMutation(request)` per §16 — normalizes `Origin`
  (scheme+hostname+effective port), compares against `APP_ORIGINS` (env, never derived from the
  request's own `Host`); `Sec-Fetch-Site: same-origin` fallback only when `Origin` is absent; both
  absent → reject.
- **Verification:** matching `Origin` passes; non-matching `Origin` rejects even if `Host` matches
  it (proving `Host` is never trusted); `Origin` absent + `Sec-Fetch-Site: same-origin` passes;
  both absent rejects; `Origin` absent + `Sec-Fetch-Site: cross-site` rejects.
- **Commit:** `feat(api): add exact same-origin CSRF guard for mutating routes`

### Task 8.2 — Rate-limit buckets and error-mapping extensions
- **Files:** `pixel-office/lib/api/rate-limit.ts` (add `paperRead`/`paperOrderWrite`/`paperReset`/
  `paperEmergencyStop` to `RateLimitBucket`), `pixel-office/lib/api/errors.ts` (add
  `GenerationMismatch` (409, includes `currentActiveGeneration`), `IdempotencyConflict` (409),
  `SerializationRetryExhausted` (409), `ProviderUnavailable` (503) `HttpError` subclasses)
- **Test files:** `pixel-office/tests/api-rate-limit.test.ts` (extend), `pixel-office/tests/api-errors.test.ts` (extend)
- **Command:** `npx vitest run tests/api-rate-limit.test.ts tests/api-errors.test.ts`
- **Verification:** each new bucket respects its own configured limit independently of the
  existing ones; each new error class maps to the exact status code from §19 in `toErrorResponse`.
- **Commit:** `feat(api): add Phase 4 rate-limit buckets and error-status mappings`

### Task 8.3 — GET routes
- **Files:** `pixel-office/app/api/trading-bot/paper/account/route.ts`,
  `.../positions/route.ts`, `.../risk-profile/route.ts`, `.../journal/route.ts`, `.../audit/route.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-get-routes.test.ts`
- **Command:** `npm run test:integration -- paper-trading-get-routes.test.ts`
- **Implementation:** each route: `requireUser()` → `getOrCreateActivePaperAccount` →
  `enforceRateLimit(userId,"paperRead")` → serve the DTO per §15's nullability rules; journal/audit
  are cursor-paginated (`limit` default 25, max 100, clamped not rejected above max).
- **Verification:** a brand-new user's first `GET /paper/account` bootstraps and returns generation
  1; `dailyRealizedPnl` is `"0.00000000"` (never null) with no day-state row yet; pagination
  cursor round-trips across two pages with no duplicate/missing rows.
- **Commit:** `feat(paper-trading): add persistent account/positions/risk-profile/journal/audit GET routes`

### Task 8.4 — `POST /paper/orders` (the full pipeline)
- **Files:** `pixel-office/app/api/trading-bot/paper/orders/route.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-orders-route.test.ts`
- **Command:** `npm run test:integration -- paper-trading-orders-route.test.ts`
- **Implementation:** the exact 9-step pipeline from §7, composing every prior checkpoint: auth/
  CSRF/Content-Type/rate-limit/structural-validation → bootstrap → resolve-by-generation
  (including archived) → payload hash → Stage-1 idempotency → generation/active check (new
  requests only) → circuit breaker → signal + valuation fetch (outside tx) → Serializable
  transaction (lock, Stage-2 idempotency, risk evaluation, write, commit).
- **Verification:** happy-path FILLED BUY; a rejection at each risk rule (spot-checking a sample,
  not all 17, since Checkpoint 6 already covers every rule's logic — this test proves the route
  wires the assembler correctly, not that the rules are individually correct); a missing
  `Content-Type` → 415; a cross-origin `Origin` → 403; an over-budget rate-limit → 429 with
  `Retry-After`; **the five replay tests** — an old FILLED order, an old REJECTED order (both
  replayed after a Reset has archived their generation), each replayed with the market-data
  provider mocked to throw on any call, asserting 200 with the correct replayed result and zero
  provider invocations.
- **Commit:** `feat(paper-trading): add POST /paper/orders with the full request pipeline`

### Task 8.5 — `POST /paper/positions/close`
- **Files:** `pixel-office/app/api/trading-bot/paper/positions/close/route.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-close-route.test.ts`
- **Command:** `npm run test:integration -- paper-trading-close-route.test.ts`
- **Verification:** happy-path partial close, happy-path full close, Emergency-Stop-active account
  still allows a close (structural proof, not just unit-level), rejection at each of C1–C5 (spot
  sample), the incomplete-valuation scenario end-to-end through the route (not just the assembler
  unit test from 7.3).
- **Commit:** `feat(paper-trading): add POST /paper/positions/close route`

### Task 8.6 — `POST /paper/reset`
- **Files:** `pixel-office/app/api/trading-bot/paper/reset/route.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-reset-route.test.ts`
- **Command:** `npm run test:integration -- paper-trading-reset-route.test.ts`
- **Verification:** happy-path reset; **reset-vs-order race** — fire a reset and a BUY concurrently
  against the same account, assert whichever wins the account lock commits and the other observes
  the committed state correctly (`GENERATION_MISMATCH` for the order if reset won); reset replay
  after a later reset (§7 step 5, §13); the reset replay test from the list above with the
  provider mocked to throw (reset never touches the provider at all, so this also proves the
  provider mock records zero calls trivially, but it's asserted explicitly).
- **Commit:** `feat(paper-trading): add POST /paper/reset route with race and replay tests`

### Task 8.7 — `POST /paper/emergency-stop`
- **Files:** `pixel-office/app/api/trading-bot/paper/emergency-stop/route.ts`
- **Test file:** `pixel-office/tests/integration/paper-trading-emergency-stop-route.test.ts`
- **Command:** `npm run test:integration -- paper-trading-emergency-stop-route.test.ts`
- **Verification:** activate then a subsequent BUY is blocked (`EMERGENCY_STOP_ACTIVE`) while a
  close still succeeds; resume then a BUY succeeds again; **stop-vs-order race** — fire an
  activation and a BUY concurrently, assert the deterministic outcome per §4's race table;
  activation-replay and resume-replay tests with the provider mocked to throw.
- **Commit:** `feat(paper-trading): add POST /paper/emergency-stop route with race and replay tests`

**Checkpoint 8 gate:** `npm test` (default suite) and `npm run test:integration` both green;
`npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` clean. All 9 API routes exist and
are fully tested end-to-end. The Phase 1 routes still exist untouched.

---

## Checkpoint 9 — UI cutover (Phase 1 deletion is the last task, gated on 9.1–9.6 green)

### Task 9.1 — Account summary component
- **Files:** `pixel-office/components/trading-bot/PaperAccountSummary.tsx`
- **Test file:** `pixel-office/tests/paper-account-summary.test.ts` (RTL, `.ts` + `createElement`,
  matching the established Phase 3 pattern for `.tsx` components under the "pure-logic `.ts`
  tests only" Vitest config policy)
- **Command:** `npx vitest run tests/paper-account-summary.test.ts`
- **Implementation:** generation badge, cash/equity/exposure display with the
  `COMPLETE`/`PARTIAL`/`UNKNOWN` freshness badge, `dailyRealizedPnl`/`dailyLossPct` display
  honoring §15's null-only-when-baseline-null rule, `observedPeakEquity`/`observedDrawdownPct`
  labeled "observed" per §10's honesty requirement, Emergency Stop status indicator.
- **Verification:** a `PARTIAL`/`UNKNOWN` equity state renders the badge and does not render a
  fabricated number; `dailyRealizedPnl` renders even when `equityCompleteness` is `UNKNOWN`.
- **Commit:** `feat(paper-trading-ui): add persistent account summary component`

### Task 9.2 — Positions table, order form, close controls
- **Files:** `pixel-office/components/trading-bot/PaperPositionsTable.tsx`,
  `pixel-office/components/trading-bot/PaperOrderForm.tsx`
- **Test file:** `pixel-office/tests/paper-order-form.test.ts`
- **Command:** `npx vitest run tests/paper-order-form.test.ts`
- **Implementation:** client-side quantity-precision validation (≤8 fractional digits) before any
  fetch, mirroring the Phase 3 backtest form's validate-before-fetch pattern; per-position close
  button; per-symbol `markStatus` badge on the positions table.
- **Verification:** a >8-fractional-digit quantity is rejected client-side with no network request
  issued (assert the fetch mock was never called), matching the Phase 3 acceptance pattern.
- **Commit:** `feat(paper-trading-ui): add positions table, order form, and close controls`

### Task 9.3 — Emergency Stop control
- **Files:** `pixel-office/components/trading-bot/PaperEmergencyStopControl.tsx`
- **Test file:** `pixel-office/tests/paper-emergency-stop-control.test.ts`
- **Command:** `npx vitest run tests/paper-emergency-stop-control.test.ts`
- **Implementation:** current-state display, activate/resume buttons each behind an explicit
  confirm dialog.
- **Verification:** clicking activate without confirming issues no request; confirming issues
  exactly one request with a freshly generated idempotency key.
- **Commit:** `feat(paper-trading-ui): add Emergency Stop control with confirm dialogs`

### Task 9.4 — Reset control
- **Files:** `pixel-office/components/trading-bot/PaperResetControl.tsx`
- **Test file:** `pixel-office/tests/paper-reset-control.test.ts`
- **Command:** `npx vitest run tests/paper-reset-control.test.ts`
- **Implementation:** shows current generation, confirm dialog explicitly stating history is
  preserved but the active session restarts at the fixed starting balance.
- **Verification:** clicking reset without confirming issues no request.
- **Commit:** `feat(paper-trading-ui): add Reset control with confirm dialog`

### Task 9.5 — Journal and audit views
- **Files:** `pixel-office/components/trading-bot/PaperJournalView.tsx`,
  `pixel-office/components/trading-bot/PaperAuditView.tsx`
- **Test file:** `pixel-office/tests/paper-journal-audit-views.test.ts`
- **Command:** `npx vitest run tests/paper-journal-audit-views.test.ts`
- **Implementation:** paginated, cursor-based "load more."
- **Verification:** loading a second page appends rows without duplicating the first page.
- **Commit:** `feat(paper-trading-ui): add paginated journal and audit history views`

### Task 9.6 — Wire `/trading-bot` page, manual browser verification
- **Files:** `pixel-office/components/trading-bot/TradingBotPageClient.tsx` (replace the Phase 1
  mock-account panel with the Task 9.1–9.5 components on the same page — no new route)
- **Test file:** `pixel-office/tests/trading-bot-page-cutover.test.ts` (static source-scan,
  mirroring the Phase 3 nav test pattern — asserts the old mock-account panel's markers are gone
  and the new components are referenced)
- **Command:** `npx vitest run tests/trading-bot-page-cutover.test.ts`, then manual: `npm run dev`,
  sign in, exercise the full BUY → close → Reset → Emergency Stop lifecycle in a browser.
- **Verification:** clean browser console throughout; every confirm dialog behaves as specified in
  9.3/9.4.
- **Commit:** `feat(paper-trading-ui): cut over /trading-bot to the persistent paper account`

### Task 9.7 — Delete the Phase 1 ephemeral system (LATE — only after 9.1–9.6 are green)
- **Files removed:** `pixel-office/app/api/trading-bot/{account,orders,positions,positions/close}/route.ts`,
  `pixel-office/lib/trading-bot/{store,mock-broker,risk-engine,strategy}.ts`
- **Files kept, now unused by the deleted routes but still referenced elsewhere if applicable:**
  none expected — `pricing.ts`/`freshness.ts`/`errors.ts`/`types.ts`/`dto.ts`/`config.ts`/`serialize.ts`
  are checked first; anything still imported by the accepted Phase 2/3 code (e.g. `freshness.ts`
  is shared with the backtest engine's staleness conventions) is **kept**, not deleted — verified
  by a repo-wide reference search before removal, per-file.
- **Test file:** `pixel-office/tests/trading-bot-safety.test.ts` (extend the glob to
  `lib/paper-trading/**`/`app/api/trading-bot/paper/**`, remove the now-nonexistent old paths from
  the glob)
- **Command:** `npx vitest run tests/trading-bot-safety.test.ts`, then a full
  `npx tsc --noEmit && npm run lint && npm run build` to confirm nothing else in the repo
  references any deleted file.
- **Verification:** build fails loudly if anything still imports a deleted module (this is the
  actual proof the deletion is safe, not an assumption); the full default `npm test` suite still
  passes (any Phase-1-specific test files for the deleted modules are deleted in this same
  commit, not left dangling and failing).
- **Commit:** `feat(paper-trading): remove the Phase 1 ephemeral in-memory trading system`

**Checkpoint 9 gate:** exactly one reachable paper-account system exists in the codebase; full
default suite, `tsc`, lint, and build all green.

---

## Checkpoint 10 — Safety scans, full verification, acceptance checklist, registry updates

### Task 10.1 — Extended safety-scan banned-identifier checks
- **Files:** `pixel-office/tests/trading-bot-safety.test.ts` (already glob-extended in 9.7; add new
  banned-identifier assertions)
- **Command:** `npx vitest run tests/trading-bot-safety.test.ts`
- **Implementation:** in addition to the existing no-`lib/exchanges/*`-import and no-credential-
  reference checks, add: no live-order-placement endpoint referenced, no scheduler/cron/
  background-poller code (`setInterval`, worker-loop patterns) anywhere in
  `lib/paper-trading/**`/`app/api/trading-bot/paper/**`, no leverage/margin/short-execution
  identifiers.
- **Verification:** the test fails if a deliberately-introduced violation is added to a scratch
  file during test authoring, then passes once removed (proving the scan actually catches what it
  claims to, not merely "the glob compiles").
- **Commit:** `test(paper-trading): extend safety scan with Phase 4 banned-identifier checks`

### Task 10.2 — Full verification run
- **Commands, in order:**
  1. `npm test` (default suite, all of Checkpoints 1/6/7/9's pure-logic tests plus every prior
     phase's existing tests)
  2. `npm run test:integration` (mandatory, real `TEST_DATABASE_URL`, every Checkpoint 2–8
     real-Postgres test — concurrent bootstrap, duplicate orders, Reset races, Emergency Stop
     races, partial closes, all replay tests, all constraint/trigger/introspection tests)
  3. `npx tsc --noEmit`
  4. `npm run lint`
  5. `rm -rf .next && npm run build` (fresh build, matching the established Phase 1–3 verification
     habit of clearing `.next` first)
- **Verification:** all five commands exit 0; record exact test counts (files/tests
  passed) in the final report to the repository owner, same as every prior phase's verification
  report.
- **No commit** (verification only — nothing to commit unless a fix is needed, in which case the
  fix gets its own commit with a description of what it corrected).

### Task 10.3 — Manual authenticated acceptance checklist (document only, not yet run)
- **Files:** `docs/superpowers/specs/2026-07-17-trading-bot-phase4-acceptance-checklist.md`
- **Implementation:** a checklist document in the same format as the Phase 1–3 checklists, covering
  at minimum: authenticated access; bootstrap on first visit; a real BUY through the full pipeline;
  a partial and a full close; hand-verify one fill's cost-basis/realized-P&L against §8's formulas;
  Emergency Stop blocks new BUYs but not closes; Emergency Stop survives a Reset; Reset preserves
  history (journal/audit still show pre-reset entries under the old generation); daily-loss and
  drawdown displays read "observed," not implying continuous monitoring; a partial-valuation close
  scenario (simulate one symbol's provider failure) shows the incomplete-valuation state honestly;
  invalid-quantity-precision input is rejected client-side with no network call; same-origin/
  Content-Type rejection spot-check via a raw cross-origin request; clean browser console
  throughout; confirmation nothing on the page places a live order or references a real broker.
- **Status recorded in this document:** "Implementation complete; authenticated interactive
  acceptance pending" — **not** Accepted, matching every prior phase's pattern exactly.
- **Commit:** `docs(trading-bot): add Phase 4 authenticated acceptance checklist`

### Task 10.4 — `FEATURE_REGISTRY.md` / `ROADMAP.md` updates
- **Files:** `pixel-office/FEATURE_REGISTRY.md`, `pixel-office/ROADMAP.md`
- **Implementation:** add the Phase 4 section with status "Implementation complete; authenticated
  interactive acceptance pending" — the same phrasing used for every prior phase before its
  checklist was actually run by the repository owner. **Do not** write "Accepted" anywhere in
  either file at this point.
- **Commit:** `docs(trading-bot): record Phase 4 implementation-complete status in FEATURE_REGISTRY and ROADMAP`

**Checkpoint 10 gate — and the plan's terminal state:** all automated gates green, the acceptance
checklist document exists and is unrun. Phase 4 is marked Accepted only in a future, separate step
once the repository owner reports the checklist passed — never as part of this plan's own commits.

---

## Self-review (performed before committing this plan)

- **Missing dependencies / circular ordering:** none found. Checkpoint order is: pure logic (1) →
  test harness against the *existing* Portfolio migrations, not yet needing Phase 4's own
  migration (2) → schema/migration, tested by the now-available harness (3) → transaction/
  bootstrap/idempotency library code, needing the schema (4) → execution accounting, needing the
  transaction wrapper and pricing formulas but not real market data (5) → risk rules, needing the
  execution writers to call on approval but not real market data either (6) → the real market-data
  I/O layer, needing nothing from 5/6 since both were built against injected plain-data contexts
  (7) → HTTP routes, the first point everything is composed together (8) → UI (9) → verification/
  registry (10). See the "Architecture note" at the top of this document for the specific
  resolution of the apparent 5/6-before-7 tension.
- **Task deleting old code before its replacement is verified:** only Task 9.7, explicitly placed
  last in Checkpoint 9, gated on 9.1–9.6 being green, with a build-failure check as the actual
  proof of safety rather than an assumption. No earlier task touches `lib/trading-bot/**` or the
  four Phase 1 routes.
- **Test accidentally using `DATABASE_URL`:** every integration test in Checkpoints 2–8 is required
  to go through the Task 2.2/2.4 harness, which is the only code path in the entire plan permitted
  to construct a `PrismaClient` pointed at a non-default URL; Task 2.4's own test statically
  confirms the harness file never imports `lib/db.ts`. No task in this plan instructs writing a
  `PrismaClient` by hand outside the harness.
- **Transaction containing network I/O:** Task 7.2's fetcher has a type signature that accepts no
  transaction/Prisma-client parameter, making it uncallable from inside a `$transaction` callback
  — a structural guarantee, not a review-time convention. Task 8.4's pipeline explicitly places the
  fetch call (step 8) before the transaction begins (step 9), matching §7 exactly.
- **Replay path contacting the provider:** Task 4.4 builds Stage-1 resolution as a standalone
  function called before any Checkpoint 7 code is reachable in the pipeline (§7 steps 5–6 precede
  step 8); Task 8.4/8.6/8.7 each include an explicit replay test with the provider mocked to throw,
  asserting zero invocations — this is checked by an assertion, not inferred from ordering alone.
- **Money calculation using JavaScript numbers:** Task 1.2 establishes `D8`/`Prisma.Decimal` as the
  only monetary primitive and is exercised by hand-calculated fixtures in Tasks 1.2, 5.1, 5.2, and
  6.2 specifically because a float-math bug would produce a fixture mismatch, not merely "look
  wrong" — this is the enforcement mechanism in the absence of a fully reliable static scanner for
  this property (a note to this effect is recorded here rather than claiming a mechanical
  guarantee that doesn't exist).
- **Incomplete placeholder or "implement later" step:** none. The one place this could have crept
  in — Checkpoint 2's harness needing a migration to test against before Phase 4's own migration
  exists — is resolved by testing the harness's migrate-apply wiring against the real, currently
  existing Portfolio-module migration history (Task 2.3), not a stub.

---

## Report template for this plan's execution (for future checkpoint check-ins)

Each checkpoint's completion report should state: tasks completed, commit hashes, test counts
(pure suite / integration suite), `tsc`/lint/build results, any deviation from this plan and why,
and working-tree status — matching the reporting discipline established across Phase 1–3.
