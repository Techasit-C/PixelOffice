# AI Trading Bot — Phase 4: Persistent Paper Trading & Full Risk Engine — Design

**Status: Approved for implementation planning (2026-07-17).**

This document is the complete, consolidated Phase 4 design. It supersedes every partial draft exchanged in chat during brainstorming. Nothing in this file has been implemented; no schema, migration, plan, or application code has been written.

---

## 1. Mandatory boundaries (unchanged from the brainstorming brief)

Phase 4 remains paper trading only. It introduces no real broker or exchange SDK, no broker credentials, no live-trading toggle, no execution outside the persistent paper engine, no leverage, no margin, no executable shorts, no automation or background bot, no destructive changes to existing Portfolio data, and no weakening of the Phase 1–3 safety tests. Phase 1's ephemeral in-memory balances and positions are explicitly **not** migrated — every user starts Phase 4 at a fresh, bootstrapped generation 1.

---

## 2. Current-state assessment — reuse vs. replace

**Reused as-is:** `requireUser()` (Clerk → internal `User.id`), the `enforceRateLimit(userId, bucket)` pattern (extended with new buckets), the `HttpError`/`toErrorResponse()` taxonomy (extended), the Decimal-as-string API-boundary convention, the `prisma.$transaction` atomic-write pattern, the trading-bot static safety-scan test pattern (glob-extended), and — critically — the accepted, tested Phase 3 pure pricing functions `askPrice`, `bidPrice`, and `D8` from `lib/backtest/{fills,decimal}.ts`, imported directly rather than reimplemented.

**Replaced entirely:** `lib/trading-bot/store.ts` (module-scoped `Map`, in-process mutex), `lib/trading-bot/mock-broker.ts`, `lib/trading-bot/risk-engine.ts` (`StubRiskEngine`'s 4 rules), and the in-memory idempotency map. `lib/trading-bot/strategy.ts`'s `SignalEngineStrategy` responsibility is **ported**, not merely deleted — see §19.

**Untouched:** every Portfolio-module table/route (zero FK relationship), and the Phase 3 backtest engine (stays stateless/historical-only; Phase 4 only imports its pure pricing functions, one-directionally — `lib/backtest/` gains no dependency on Phase 4).

---

## 3. Architecture recommendation

Row lock (`SELECT ... FOR UPDATE`) on the account row, combined with `SERIALIZABLE` transaction isolation, combined with a bounded retry restricted to Postgres `40001` (serialization_failure) and `40P01` (deadlock_detected) only. No optimistic version column, no in-process JavaScript mutex used for correctness.

---

## 4. Complete schema

### 4.1 Enums

```prisma
enum PaperAccountStatus   { ACTIVE ARCHIVED }
enum PaperOrderSide       { BUY SELL }
enum PaperOrderStatus     { FILLED REJECTED }
enum JournalEntryType     { ORDER_FILLED ORDER_REJECTED RISK_BREACH EMERGENCY_STOP RESET VALUATION_INCOMPLETE }
enum AuditAction          { ORDER_PLACED ORDER_REJECTED EMERGENCY_STOP_ACTIVATED EMERGENCY_STOP_RESUMED ACCOUNT_RESET }
enum AuditEntityType      { PAPER_ORDER PAPER_ACCOUNT EMERGENCY_STOP_STATE }
enum CommandType          { RESET EMERGENCY_STOP_ACTIVATE EMERGENCY_STOP_RESUME }
enum SnapshotTrigger      { FILL RESET BOOTSTRAP }
enum SnapshotCompleteness { COMPLETE PARTIAL }
```

### 4.2 Models

The existing `User` model gains two additive back-relations: `paperAccounts PaperAccount[]` and `paperAuditLogs PaperAuditLog[]`. Nothing else on `User` changes.

Every quantity, price, fee, notional, and cost-basis column uses one scale: `Decimal(20,8)`. There is no `Decimal(30,10)` and no `Q10` anywhere in Phase 4. `RiskProfile` percentage fields use `Decimal(5,2)`; the one persisted percentage output, `drawdownPct`, uses `Decimal(6,2)` — all percentage-point scale (`0.5` means 0.5%), never a 0–1 fraction.

```prisma
model PaperAccount {
  id                 String             @id @default(cuid())
  userId             String
  generation         Int
  status             PaperAccountStatus @default(ACTIVE)
  startingBalance    Decimal            @db.Decimal(20, 8)
  cashBalance        Decimal            @db.Decimal(20, 8)
  observedPeakEquity Decimal            @db.Decimal(20, 8)
  createdAt          DateTime           @default(now())
  archivedAt         DateTime?

  user            User                  @relation(fields: [userId], references: [id], onDelete: Restrict)
  positions       PaperPosition[]
  orders          PaperOrder[]
  fills           PaperFill[]
  commands        PaperCommand[]
  riskProfile     RiskProfile?
  emergencyStop   EmergencyStopState?
  equitySnapshots PaperEquitySnapshot[]
  journal         PaperTradeJournal[]
  dayStates       PaperRiskDayState[]

  @@unique([userId, generation])
  @@unique([id, userId])
  @@index([userId, status])
  @@map("paper_accounts")
}

model RiskProfile {
  id                  String   @id @default(cuid())
  paperAccountId      String   @unique
  maxRiskPerTradePct  Decimal  @default(0.5)  @db.Decimal(5, 2)
  maxPositionSizePct  Decimal  @default(20)   @db.Decimal(5, 2)
  maxTotalExposurePct Decimal  @default(50)   @db.Decimal(5, 2)
  maxOpenPositions    Int      @default(3)
  dailyLossLimitPct   Decimal  @default(2)    @db.Decimal(5, 2)
  maxDrawdownPct      Decimal  @default(10)   @db.Decimal(5, 2)
  maxOrdersPerWindow  Int      @default(5)
  orderWindowMinutes  Int      @default(60)
  cooldownAfterLosses Int      @default(3)
  cooldownMinutes     Int      @default(60)
  createdAt           DateTime @default(now())

  account PaperAccount @relation(fields: [paperAccountId], references: [id], onDelete: Cascade)

  @@map("risk_profiles")
}

model PaperRiskDayState {
  id                    String    @id @default(cuid())
  paperAccountId        String
  utcDate               DateTime  @db.Date
  baselineEquity        Decimal?  @db.Decimal(20, 8)
  baselineEstablishedAt DateTime?
  dailyRealizedPnl      Decimal   @default(0) @db.Decimal(20, 8)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  account PaperAccount @relation(fields: [paperAccountId], references: [id], onDelete: Restrict)

  @@unique([paperAccountId, utcDate])
  @@map("paper_risk_day_state")
}

model PaperOrder {
  id                String           @id @default(cuid())
  paperAccountId    String
  generation        Int
  idempotencyKey    String
  payloadHash       String
  hashVersion       String           @default("v1")
  symbol            String
  side              PaperOrderSide
  requestedQuantity Decimal          @db.Decimal(20, 8)
  signalGeneratedAt DateTime?
  signalHash        String?
  entryStopLoss     Decimal?         @db.Decimal(20, 8)
  entryTakeProfit   Json?
  status            PaperOrderStatus
  reasonCode        String?
  reason            String?          @db.VarChar(300)
  createdAt         DateTime         @default(now())

  account        PaperAccount        @relation(fields: [paperAccountId], references: [id], onDelete: Restrict)
  fill           PaperFill?
  journalEntries PaperTradeJournal[]

  @@unique([paperAccountId, idempotencyKey])
  @@unique([id, paperAccountId])
  @@index([paperAccountId, createdAt])
  @@map("paper_orders")
}

model PaperFill {
  id                 String         @id @default(cuid())
  orderId            String         @unique
  paperAccountId     String
  symbol             String
  side               PaperOrderSide
  quantity           Decimal        @db.Decimal(20, 8)
  referenceMark      Decimal        @db.Decimal(20, 8)
  price              Decimal        @db.Decimal(20, 8)
  fee                Decimal        @db.Decimal(20, 8)
  notional           Decimal        @db.Decimal(20, 8)
  allocatedCostBasis Decimal?       @db.Decimal(20, 8)
  realizedPnl        Decimal?       @db.Decimal(20, 8)
  appliedFeeRate     Decimal        @db.Decimal(8, 6)
  appliedSpreadBps   Int
  appliedSlippageBps Int
  executedAt         DateTime

  order   PaperOrder   @relation(fields: [orderId, paperAccountId], references: [id, paperAccountId])
  account PaperAccount @relation(fields: [paperAccountId], references: [id], onDelete: Restrict)

  @@index([paperAccountId, executedAt])
  @@map("paper_fills")
}

model PaperPosition {
  id             String   @id @default(cuid())
  paperAccountId String
  symbol         String
  quantity       Decimal  @db.Decimal(20, 8)
  costBasis      Decimal  @db.Decimal(20, 8)
  realizedPnl    Decimal  @db.Decimal(20, 8)
  updatedAt      DateTime @updatedAt

  account PaperAccount @relation(fields: [paperAccountId], references: [id], onDelete: Cascade)

  @@unique([paperAccountId, symbol])
  @@map("paper_positions")
}

model PaperEquitySnapshot {
  id                  String               @id @default(cuid())
  paperAccountId      String
  capturedAt          DateTime
  trigger             SnapshotTrigger
  triggerId           String
  completeness        SnapshotCompleteness
  cash                Decimal              @db.Decimal(20, 8)
  knownPositionsValue Decimal              @db.Decimal(20, 8)
  equity              Decimal?             @db.Decimal(20, 8)
  drawdownPct         Decimal?             @db.Decimal(6, 2)
  missingSymbols      Json?

  account PaperAccount @relation(fields: [paperAccountId], references: [id], onDelete: Restrict)

  @@unique([paperAccountId, trigger, triggerId])
  @@index([paperAccountId, capturedAt])
  @@map("paper_equity_snapshots")
}

model PaperTradeJournal {
  id                    String           @id @default(cuid())
  paperAccountId        String
  relatedOrderId        String?
  relatedOrderAccountId String?
  entryType             JournalEntryType
  message                String          @db.VarChar(500)
  riskContext            Json?
  createdAt               DateTime       @default(now())

  account      PaperAccount @relation(fields: [paperAccountId], references: [id], onDelete: Restrict)
  relatedOrder PaperOrder?  @relation(fields: [relatedOrderId, relatedOrderAccountId], references: [id, paperAccountId])

  @@index([paperAccountId, createdAt])
  @@map("paper_trade_journal")
}

model PaperAuditLog {
  id         String          @id @default(cuid())
  userId     String
  action     AuditAction
  entityType AuditEntityType
  entityId   String
  metadata   Json?
  createdAt  DateTime        @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@index([userId, createdAt])
  @@index([entityType, entityId])
  @@map("paper_audit_log")
}

model EmergencyStopState {
  id                String    @id @default(cuid())
  paperAccountId    String    @unique
  isActive          Boolean   @default(false)
  reason            String?   @db.VarChar(300)
  activatedAt       DateTime?
  activatedByUserId String?
  resumedAt         DateTime?
  resumedByUserId   String?
  updatedAt         DateTime  @updatedAt

  account PaperAccount @relation(fields: [paperAccountId], references: [id], onDelete: Cascade)

  @@map("emergency_stop_state")
}

model PaperCommand {
  id                  String      @id @default(cuid())
  paperAccountId      String
  commandType         CommandType
  idempotencyKey      String
  payloadHash         String
  hashVersion         String      @default("v1")
  expectedGeneration  Int
  resultGeneration    Int?
  resultJson          Json
  resultSchemaVersion String      @default("v1")
  createdAt           DateTime    @default(now())

  account PaperAccount @relation(fields: [paperAccountId], references: [id], onDelete: Restrict)

  @@unique([paperAccountId, commandType, idempotencyKey])
  @@map("paper_commands")
}
```

11 models, 9 enums. Every relation field on `PaperAccount` is present: `user`, `positions`, `orders`, `fills`, `commands`, `riskProfile`, `emergencyStop`, `equitySnapshots`, `journal`, `dayStates`.

### 4.3 Raw SQL — one active account per user, and value/consistency CHECK constraints

Not expressed in Prisma DSL (unverified as stable at the installed `prisma@^6.19.3`); appended to the generated migration.

```sql
CREATE UNIQUE INDEX paper_accounts_one_active_per_user
  ON paper_accounts(user_id)
  WHERE status = 'ACTIVE';

ALTER TABLE paper_accounts ADD CONSTRAINT cash_non_negative        CHECK (cash_balance >= 0);
ALTER TABLE paper_accounts ADD CONSTRAINT generation_positive      CHECK (generation > 0);
ALTER TABLE paper_accounts ADD CONSTRAINT starting_balance_positive CHECK (starting_balance > 0);
ALTER TABLE paper_accounts ADD CONSTRAINT peak_equity_positive     CHECK (observed_peak_equity > 0);
ALTER TABLE paper_accounts ADD CONSTRAINT status_archived_at_consistency CHECK (
  (status = 'ACTIVE'   AND archived_at IS NULL)
  OR
  (status = 'ARCHIVED' AND archived_at IS NOT NULL)
);

ALTER TABLE paper_positions ADD CONSTRAINT position_qty_strictly_positive CHECK (quantity > 0);
ALTER TABLE paper_positions ADD CONSTRAINT cost_basis_non_negative        CHECK (cost_basis >= 0);

ALTER TABLE paper_orders ADD CONSTRAINT requested_qty_positive CHECK (requested_quantity > 0);
ALTER TABLE paper_orders ADD CONSTRAINT rejected_requires_reason_code CHECK (
  (status = 'REJECTED' AND reason_code IS NOT NULL)
  OR
  (status = 'FILLED'   AND reason_code IS NULL)
);

ALTER TABLE paper_fills ADD CONSTRAINT fill_quantity_positive       CHECK (quantity > 0);
ALTER TABLE paper_fills ADD CONSTRAINT fill_price_positive          CHECK (price > 0);
ALTER TABLE paper_fills ADD CONSTRAINT fill_reference_mark_positive CHECK (reference_mark > 0);
ALTER TABLE paper_fills ADD CONSTRAINT fill_notional_positive       CHECK (notional > 0);
ALTER TABLE paper_fills ADD CONSTRAINT fill_fee_non_negative        CHECK (fee >= 0);
ALTER TABLE paper_fills ADD CONSTRAINT fill_allocated_cost_basis_non_negative
  CHECK (allocated_cost_basis IS NULL OR allocated_cost_basis >= 0);
ALTER TABLE paper_fills ADD CONSTRAINT applied_fee_rate_bounds
  CHECK (applied_fee_rate >= 0 AND applied_fee_rate <= 1);
ALTER TABLE paper_fills ADD CONSTRAINT applied_spread_bps_non_negative   CHECK (applied_spread_bps >= 0);
ALTER TABLE paper_fills ADD CONSTRAINT applied_slippage_bps_non_negative CHECK (applied_slippage_bps >= 0);

ALTER TABLE risk_profiles ADD CONSTRAINT risk_pct_bounds CHECK (
  max_risk_per_trade_pct  BETWEEN 0 AND 100 AND
  max_position_size_pct   BETWEEN 0 AND 100 AND
  max_total_exposure_pct  BETWEEN 0 AND 100 AND
  daily_loss_limit_pct    BETWEEN 0 AND 100 AND
  max_drawdown_pct        BETWEEN 0 AND 100
);
ALTER TABLE risk_profiles ADD CONSTRAINT risk_profile_counts_positive CHECK (
  max_open_positions    >= 1 AND
  max_orders_per_window >= 1 AND
  order_window_minutes  >= 1 AND
  cooldown_after_losses >= 1 AND
  cooldown_minutes      >= 1
);

ALTER TABLE emergency_stop_state ADD CONSTRAINT stop_timestamp_consistency CHECK (
  (is_active = true  AND activated_at IS NOT NULL AND resumed_at IS NULL)
  OR
  (is_active = false AND activated_at IS NULL AND resumed_at IS NULL)
  OR
  (is_active = false AND activated_at IS NOT NULL AND resumed_at IS NOT NULL AND resumed_at >= activated_at)
);

ALTER TABLE paper_equity_snapshots ADD CONSTRAINT snapshot_completeness_nullability CHECK (
  (completeness = 'COMPLETE' AND equity IS NOT NULL AND drawdown_pct IS NOT NULL AND missing_symbols IS NULL)
  OR
  (completeness = 'PARTIAL'  AND equity IS NULL     AND drawdown_pct IS NULL     AND missing_symbols IS NOT NULL)
);
ALTER TABLE paper_equity_snapshots ADD CONSTRAINT partial_snapshot_has_missing_symbols
  CHECK (completeness = 'COMPLETE' OR jsonb_array_length(missing_symbols) > 0);

ALTER TABLE paper_risk_day_state ADD CONSTRAINT baseline_both_or_neither CHECK (
  (baseline_equity IS NULL) = (baseline_established_at IS NULL)
);
ALTER TABLE paper_risk_day_state ADD CONSTRAINT baseline_equity_positive
  CHECK (baseline_equity IS NULL OR baseline_equity > 0);
```

`missing_symbols` being sorted and de-duplicated is validated by the one pure function that constructs it (unit-tested), not by a database expression — non-emptiness is the part enforced at the database level.

### 4.4 Composite cross-account foreign keys

`PaperFill.(orderId, paperAccountId) → PaperOrder(id, paperAccountId)` (declared in the Prisma relation above, backed by `PaperOrder`'s `@@unique([id, paperAccountId])`) makes it structurally impossible for a fill's `paperAccountId` to diverge from its order's actual account.

`PaperTradeJournal.(relatedOrderId, relatedOrderAccountId) → PaperOrder(id, paperAccountId)` is nullable (journal entries not tied to an order — `RESET`, `EMERGENCY_STOP` — have both columns null). Two additional raw-SQL `CHECK` constraints close the remaining gap Prisma cannot express:

```sql
ALTER TABLE paper_trade_journal
  ADD CONSTRAINT related_order_both_or_neither
  CHECK ((related_order_id IS NULL) = (related_order_account_id IS NULL));

ALTER TABLE paper_trade_journal
  ADD CONSTRAINT related_order_same_account
  CHECK (related_order_account_id IS NULL OR related_order_account_id = paper_account_id);
```

A manually inserted cross-account journal/order pair is rejected by Postgres itself (FK violation `23503` or CHECK violation `23514`) — verified by a real-Postgres test that performs exactly that insert.

### 4.5 Append-only triggers

`onDelete: Restrict` only blocks deleting the parent while children exist; it does not stop a direct `UPDATE`/`DELETE` on a child row. Six tables — every genuinely write-once ledger/history table — get a trigger:

```sql
CREATE OR REPLACE FUNCTION reject_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER paper_trade_journal_append_only    BEFORE UPDATE OR DELETE ON paper_trade_journal    FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
CREATE TRIGGER paper_audit_log_append_only        BEFORE UPDATE OR DELETE ON paper_audit_log        FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
CREATE TRIGGER paper_orders_append_only           BEFORE UPDATE OR DELETE ON paper_orders           FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
CREATE TRIGGER paper_fills_append_only            BEFORE UPDATE OR DELETE ON paper_fills            FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
CREATE TRIGGER paper_commands_append_only         BEFORE UPDATE OR DELETE ON paper_commands         FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
CREATE TRIGGER paper_equity_snapshots_append_only BEFORE UPDATE OR DELETE ON paper_equity_snapshots FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
```

`PaperRiskDayState` is deliberately excluded — it is a legitimately mutable running-state row. `PaperPosition`, `RiskProfile`, `EmergencyStopState` are also excluded — mutable current-state caches, not history.

A foreign-key `Restrict` or a trigger prevents *ordinary* row-level mutation through the application's normal Prisma client. It does **not** make `DROP TABLE ... CASCADE` or `DROP SCHEMA ... CASCADE` physically impossible — privileged destructive DDL bypasses row-level constraints entirely. The real protection against a destructive rollback is procedural (§24), not a technical database guarantee.

Tests: for each of the six append-only tables, a direct `UPDATE` and a direct `DELETE` against an existing row, each asserted to raise the trigger's exception — in addition to (not instead of) the separate "delete the parent `PaperAccount`" test.

---

## 5. Execution constants and concurrency-safe bootstrap

### 5.1 Constants

Matching the already-accepted Phase 1/Phase 3 defaults exactly:

```
PAPER_STARTING_BALANCE = new Prisma.Decimal("10000.00000000")   // 10,000 USDT
PAPER_FEE_RATE         = new Prisma.Decimal("0.001")            // 0.1%
PAPER_SPREAD_BPS       = 5
PAPER_SLIPPAGE_BPS     = 5
```

Every `PaperFill` persists the exact constants applied to it (`appliedFeeRate`, `appliedSpreadBps`, `appliedSlippageBps`, §4.2) so a future change to these constants never retroactively reinterprets historical fills. For `REJECTED` orders (no `PaperFill`), the constants used to compute the rejected comparison are captured in that decision's `PaperTradeJournal.riskContext`.

### 5.2 `getOrCreateActivePaperAccount(userId)`

```
1. Lock the User row FOR UPDATE.
2. SELECT * FROM paper_accounts WHERE user_id=$userId AND status='ACTIVE' FOR UPDATE.
   - Found → return it.
   - Not found → INSERT generation 1 {
       startingBalance: PAPER_STARTING_BALANCE,
       cashBalance: PAPER_STARTING_BALANCE,
       observedPeakEquity: PAPER_STARTING_BALANCE
     } (backstopped by @@unique([userId, generation]) and the partial unique
     "one active per user" index, §4.3);
     INSERT RiskProfile with the documented defaults;
     INSERT EmergencyStopState { isActive: false };
     INSERT PaperEquitySnapshot { trigger: BOOTSTRAP, triggerId: "1",
       completeness: COMPLETE, cash: PAPER_STARTING_BALANCE,
       knownPositionsValue: 0, equity: PAPER_STARTING_BALANCE, drawdownPct: 0 };
     commit this as its own transaction, independent of whatever request
     triggered it; return the newly created row.
```

`BOOTSTRAP` is a distinct `SnapshotTrigger` value, not `RESET` — a bootstrap is not a reset and stays distinguishable in history.

Called by **every** `/api/trading-bot/paper/*` route — `GET` and `POST` alike — at the point specified in the pipeline (§7, step 2). It consumes no idempotency key and creates no `PaperOrder`/`PaperCommand`. If a subsequent provider call or the order/command transaction later fails, the already-committed, empty, bootstrapped account simply remains — no financial mutation occurred.

**Test:** fire N parallel first requests (a mix of `GET /paper/account` and `POST /paper/orders`, `expectedGeneration=1`) from a brand-new user with no existing `PaperAccount`; assert exactly one `generation=1` row exists and every response resolves to the same `paperAccountId`.

---

## 6. Lock ordering and retry policy

1. `User` row (bootstrap only).
2. Active `PaperAccount` row (`FOR UPDATE`).
3. `EmergencyStopState`/`RiskProfile` (read only).
4. `PaperPosition` rows, ascending `symbol` order.
5. `PaperOrder`/`PaperFill` (inserts only).
6. `PaperEquitySnapshot`/`PaperTradeJournal`/`PaperAuditLog`/`PaperRiskDayState` (inserts/upserts, last).

Retry: only `40001`/`40P01`, max 3 attempts, jittered backoff (~20/60/150ms + jitter); every other error propagates immediately, never retried. The retried closure performs zero network I/O.

---

## 7. Complete request pipeline (mutating routes)

Corrects the prior ordering, which compared `expectedGeneration` against only the current active account before Stage-1 idempotency — that would break legitimate replay of a request whose addressed generation has since been archived by a Reset.

```
1. requireUser() → 401 on failure.
   assertSameOriginMutation(request) → 403 on failure (§13).
   Require Content-Type: application/json → 415 otherwise.
   enforceRateLimit(userId, bucket).
   Zod-validate the request body structurally: types, symbol whitelist,
   quantity has at most 8 fractional digits, expectedGeneration is a
   positive integer, idempotencyKey is present. This step does NOT yet
   check expectedGeneration against any real account state.

2. getOrCreateActivePaperAccount(userId) — §5.2. Ensures at least a
   generation-1 ACTIVE account exists, independent of and committed before
   the rest of this request.

3. Resolve the addressed account:
     SELECT * FROM paper_accounts
     WHERE user_id = $userId AND generation = $expectedGeneration
   — a plain, unlocked read, ALWAYS scoped by the authenticated userId, and
   it INCLUDES archived accounts, not only the active one. A generation
   number belonging to another user returns no row — this is the structural
   cross-user protection, not a separate check. If no row is found at all
   (even after step 2 — the client named a generation that never existed
   for this user) → 409 GENERATION_MISMATCH, including the user's actual
   current active generation in the response body. Never a 404 or any other
   ownership-leaking response.

4. Compute the canonical payload + payloadHash for this request (§14).

5. STAGE 1 — idempotency preflight, against the account resolved in step 3
   (whichever generation that is — active or archived):
     SELECT * FROM paper_orders / paper_commands
     WHERE paper_account_id = <step 3's account id>
       AND idempotency_key = $idempotencyKey
       [AND command_type = $commandType for PaperCommand]
   - found + payloadHash matches → return the immutable stored result now.
     Zero provider calls, zero writes, zero transaction. DONE. This is what
     makes replay of an old, now-archived generation's order/command
     succeed even after one or more later resets: step 3 already located
     that exact archived account, and this check runs against it directly,
     before ever asking "is this the current generation."
   - found + payloadHash differs → 409 IdempotencyConflict now. Zero
     writes. DONE.
   - not found → continue to step 6.

6. Reached only for a genuinely new request (no stored record found in step
   5). NOW, and only now, require that the account resolved in step 3 is
   the account currently ACTIVE for this user (its status must be ACTIVE;
   equivalently its generation must equal the current active generation
   returned by step 2) — if it is not → 409 GENERATION_MISMATCH, including
   the current active generation. A stale expectedGeneration on a REPLAY
   never reaches this check at all, because step 5 already returned.

7. Circuit-breaker check — BUY/open requests only (§17). Never evaluated
   for a close, reset, or Emergency Stop command.

8. Outside any transaction: re-derive the signal (BUY only, via the
   persistent signal adapter, §19) and/or fetch fresh marks, bounded by an
   internal provider deadline. Timeout/failure → 503 PROVIDER_UNAVAILABLE,
   no mutation, no transaction opened.

9. Begin ONE prisma.$transaction(..., { isolationLevel: Serializable }).
   Lock the current active account row FOR UPDATE.
   Repeat the idempotency check from step 5, now under the lock (closes the
   preflight-to-lock race — a concurrent duplicate could have committed
   between steps 5 and 9): found+match → replay, zero new writes, commit
   read-only; found+mismatch → 409, zero writes; not found → re-verify
   expectedGeneration/status once more against the now-locked row, then run
   the full Risk Engine evaluation (§11/§12/§13) and the shared
   valuation-observation step (§11), write the fill-or-reject atomically,
   commit.
```

For a genuinely new RESET request, step 9's "not found" branch is what archives the old account and creates the new generation, per the state machine in §15.

**Replay tests:** an old FILLED order, an old REJECTED order, a RESET, an EMERGENCY_STOP_ACTIVATE, and an EMERGENCY_STOP_RESUME, each replayed after one or more later resets have occurred, with the market-data provider mocked to throw on any call — asserting 200 with the correct replayed result and zero provider invocations in every case.

---

## 8. Canonical pricing and cost-basis formulas

Reused directly from `lib/backtest/{fills,decimal}.ts`: `askPrice`, `bidPrice`, `D8` (8dp, `ROUND_HALF_UP`). `Q8` is not used by Phase 4 — quantity is never auto-sized; user-supplied `requestedQuantity` with more than 8 fractional digits is rejected (`INVALID_QUANTITY_PRECISION`), never floored.

```
entryExecutionPrice = askPrice(referenceMark, spreadBps, slippageBps)
entryNotional         = D8(quantity × entryExecutionPrice)          // ask-based — cash/fee/fill accounting only
entryFee               = D8(entryNotional × feeRate)
entryCost (totalEntryCashOut) = D8(entryNotional + entryFee)
newCostBasis = previousCostBasis + entryCost                        // previousCostBasis = 0 when opening

exitExecutionPrice = bidPrice(referenceMark, spreadBps, slippageBps)
exitNotional          = D8(quantity × exitExecutionPrice)
exitFee                = D8(exitNotional × feeRate)
exitProceeds (netExitProceeds) = D8(exitNotional − exitFee)

Partial close: allocatedCostBasis = D8(previousCostBasis × (closedQuantity / previousQuantity))
Full close:    allocatedCostBasis = previousCostBasis                // exact, no rounding dust
realizedPnl        = D8(exitProceeds − allocatedCostBasis)
remainingCostBasis = D8(previousCostBasis − allocatedCostBasis)      // exactly 0 on a full close
```

Position deleted only when `quantity == 0 AND remainingCostBasis == 0`, guaranteed by the full-close branch above.

**Pre-trade risk amount:**
```
stopExecutionPrice     = bidPrice(stopLoss, spreadBps, slippageBps)
stopNotional             = D8(quantity × stopExecutionPrice)
stopFee                   = D8(stopNotional × feeRate)
netExitProceedsAtStop      = D8(stopNotional − stopFee)
riskAmount = max(0, entryCost − netExitProceedsAtStop)
riskPct    = D8(100 × riskAmount / preTradeEquity)
```
Computed with the exact same `askPrice`/`bidPrice`/`D8` functions used for real fills — a parity test computes `riskAmount` pre-trade for a hypothetical stop-hit, then simulates an actual close fill at exactly the stop price, and asserts the two figures are bit-identical Decimals.

---

## 9. Valuation, equity, and the corrected exposure convention

```
entryNotional               = D8(quantity × askPrice(referenceMark, spreadBps, slippageBps))
                               // ask-based — cash, fees, cost basis, fill accounting ONLY
newPositionLiquidationValue = D8(quantity × bidPrice(referenceMark, spreadBps, slippageBps))
                               // bid-based — position-size and total-exposure LIMITS ONLY

positionNotional(symbol)  = D8(quantity × bidPrice(marks[symbol].referenceMark, spreadBps, slippageBps))
totalExposure               = D8(Σ positionNotional(symbol)) over open positions
preTradeEquity               = D8(cashBalance + totalExposure)
postFillCash                  = D8(cashBalance − entryCost)
postFillTotalExposure          = D8(preTradeTotalExposure + newPositionLiquidationValue)
```

`MAX_POSITION_SIZE` and `MAX_TOTAL_EXPOSURE` (§12, rules 10–11) both use the bid-based `newPositionLiquidationValue`/`postFillTotalExposure` — the same convention as every other exposure/equity computation in this design (`totalExposure`, `preTradeEquity`, `observedDrawdownPct`). The ask-based `entryNotional` is reserved exclusively for cash/fee/cost-basis accounting and never appears in an exposure-limit comparison — this was a deliberate choice to avoid a second, inconsistent exposure convention, not an oversight.

`INSUFFICIENT_FUNDS` (§12, rule 17) uses `entryCost` (ask-based, cash-accurate), unaffected by this convention.

---

## 10. Daily-loss baseline and observed peak equity — shared BUY/SELL observation step

A BUY's pre-trade valuation is `COMPLETE` only if rule 4 (full mark coverage over every held symbol) passes; otherwise the evaluation never reaches a computed `preTradeEquity` at all.

A SELL's pre-trade valuation is `COMPLETE` if, in addition to the target symbol's mark (always required just to execute the close — §12/§13), every OTHER currently held symbol also has a fresh mark at evaluation time. This coverage is **never required** for a SELL to proceed (§13) — it only determines whether that SELL's evaluation additionally counts as `COMPLETE` for observation purposes. If any other held symbol lacks a fresh mark, the SELL's valuation is `PARTIAL`: it still executes, using only the target mark, but does not feed observation.

**Shared observation step**, applied identically to a `COMPLETE` BUY or a `COMPLETE` SELL evaluation whose `preTradeEquity > 0`:
```
BASELINE (runs once, before any rule that reads it — before opening rule 13,
and, for a close, before the fill is written):
  if today's PaperRiskDayState.baselineEquity IS NULL:
    establish it now: baselineEquity = preTradeEquity, baselineEstablishedAt = now
    (creating the day-row first if it doesn't exist yet)
  This write happens unconditionally at this point, regardless of whether
  the order/close is ultimately FILLED or REJECTED by a later rule.

EPILOGUE (runs at the end of the transaction, for every COMPLETE evaluation
that reached this point, whether the final outcome is FILLED or REJECTED):
  observedPeakEquity = max(existingPeak, preTradeEquity)
```

A `PARTIAL` evaluation never establishes the baseline and never updates `observedPeakEquity`. A BUY rejected by rule 5 (`NON_POSITIVE_EQUITY`, `preTradeEquity` is exactly `0`, never negative) still reaches the epilogue: `max(existingPeak, 0)` is always a safe no-op since `existingPeak` is always `> 0` (`peak_equity_positive` CHECK).

**Every committed SELL fill updates `dailyRealizedPnl` unconditionally**, independent of the above and independent of `COMPLETE`/`PARTIAL`:
```
utcDate = today's UTC date
UPSERT PaperRiskDayState (paperAccountId, utcDate):
  no row exists → CREATE { baselineEquity: null, baselineEstablishedAt: null,
                             dailyRealizedPnl: thisFill.realizedPnl }
  row exists     → UPDATE { dailyRealizedPnl: existingRow.dailyRealizedPnl + thisFill.realizedPnl }
                    (baselineEquity/baselineEstablishedAt untouched by this step)
```
This is what prevents a `PARTIAL` close's realized loss from being lost — the accrual runs regardless of valuation completeness; only the baseline/peak observation is gated on `COMPLETE`.

**Structural close rejections that occur before a reliable valuation exists skip observation entirely — they never fabricate one.** Concretely: for a close, rules C1–C4 (generation match, position exists, quantity bounded, target-symbol freshness) and C5 (state confirmability) must all pass before observation is even attempted; once C1–C5 pass, a close always fills (there are no risk-budget rules downstream of C5 for a close), so observation is attempted exactly once, immediately before the fill is written, using marks read within the same locked transaction. A close rejected by C1–C5 never attempts to read other-symbol marks and never touches the baseline or `observedPeakEquity` — a reliable valuation was never established for it in the first place.

**Test:** seed an account with no `PaperRiskDayState` row for today; submit a BUY that passes rules 1–8 but fails at rule 9 (`MAX_RISK_PER_TRADE`), i.e. rejected before reaching rule 13. Assert the order is `REJECTED`; a day-row now exists with `baselineEquity = preTradeEquity`, `dailyRealizedPnl = 0`; `observedPeakEquity` reflects `max(priorPeak, preTradeEquity)` — tested both where this is a new high and where it is not.

---

## 11. Risk Engine — opening rules (1–17), full and final

`RISK_UNCONFIRMED` is fail-closed for every rule whose required input cannot be definitively read. First-failure semantics: rules evaluate strictly in order; the first failure wins and no later rule is evaluated.

1. **Generation match** — `expectedGeneration == locked.generation` — `GENERATION_MISMATCH`.
2. **Emergency Stop** — `EmergencyStopState.isActive == false` — `EMERGENCY_STOP_ACTIVE`. A missing stop row is `RISK_UNCONFIRMED`, never assumed inactive.
3. **Candle freshness, ordered symbol** — `age(mark) ≤ window` inclusive — `STALE_CANDLE_DATA`.
4. **Mark coverage, every held symbol** — `RISK_UNCONFIRMED` on any gap. Produces `preTradeEquity`.
5. **Non-positive equity** — `preTradeEquity > 0` strictly — `NON_POSITIVE_EQUITY`.
6. **Stop-loss present** — `sourceSignal.stopLoss != null` — `MISSING_STOP_LOSS`.
7. **Stop-loss direction** — `stopLoss > 0 AND stopLoss < entryExecutionPrice` — `INVALID_STOP_LOSS`.
8. **No pyramiding** — no existing `PaperPosition` with `quantity > 0` for this symbol — `POSITION_ALREADY_OPEN`.
9. **Max risk per trade** — `riskPct ≤ 0.5` inclusive — `MAX_RISK_PER_TRADE`.
10. **Max position size** — `newPositionLiquidationValue ≤ D8((maxPositionSizePct / 100) × preTradeEquity)` inclusive — `MAX_POSITION_SIZE`.
11. **Max total exposure** — `postFillTotalExposure ≤ D8((maxTotalExposurePct / 100) × preTradeEquity)` inclusive — `MAX_TOTAL_EXPOSURE`.
12. **Max open positions** — pass when `existingCount < maxOpenPositions`; otherwise reject `MAX_OPEN_POSITIONS`.
13. **Daily loss limit** — establish a missing baseline per the observation sequence in §10, then reject `DAILY_LOSS_LIMIT` when `dailyLossPct >= dailyLossLimitPct`.
14. **Maximum observed drawdown** — reject `MAX_DRAWDOWN` when `observedDrawdownPct >= maxDrawdownPct`.
15. **Maximum opening-order frequency** — count only `FILLED` `BUY`/open orders whose fill `executedAt` lies inside the trailing `orderWindowMinutes` window (`SELECT COUNT(*) FROM paper_fills f JOIN paper_orders o ON f.order_id = o.id WHERE o.paper_account_id = $1 AND o.side = 'BUY' AND o.status = 'FILLED' AND f.executed_at >= now() - orderWindowMinutes`). Reject when the existing count is already `>= maxOrdersPerWindow` — `MAX_ORDER_FREQUENCY`.
16. **Consecutive-loss cooldown** — determine trailing `SELL` fills ordered newest first; stop counting at the first fill whose fee-inclusive `realizedPnl >= 0`. When the trailing loss count is at least `cooldownAfterLosses`, set `cooldownExpiry = mostRecentLoss.executedAt + cooldownMinutes` (`mostRecentLoss` = the newest fill in that trailing run). Pass when no cooldown applies or `now >= cooldownExpiry`. Reject `COOLDOWN_ACTIVE` only when `now < cooldownExpiry`.
17. **No leverage/margin** — require `entryCost <= cashBalance`, equivalently `postFillCash >= 0` — otherwise reject `INSUFFICIENT_FUNDS`.

All 17 rules, numbered sequentially, no gap.

**Boundary tests, every equality case:** rule 9 `riskPct == 0.5` passes; rule 10/11 exact equality passes; rule 12 `existingCount == maxOpenPositions − 1` passes, `== maxOpenPositions` rejects; rule 13 `dailyLossPct == dailyLossLimitPct` rejects; rule 14 `observedDrawdownPct == maxDrawdownPct` rejects; rule 15 `count == maxOrdersPerWindow − 1` passes, `== maxOrdersPerWindow` rejects; rule 16 `now == cooldownExpiry` passes; rule 17 `entryCost == cashBalance` passes. Plus §10's zero-equity tests and §11-rule-7's stop-direction tests (below entry passes; equal to, above, zero, and negative all reject `INVALID_STOP_LOSS`).

---

## 12. Risk Engine — closing rules (C1–C5)

Intentionally minimal — rules 2 and 5–16 above never apply to a close.

1. **Generation match** — same as opening rule 1.
2. **Position exists** — `PaperPosition.quantity > 0` for symbol — `NO_OPEN_POSITION`.
3. **Quantity bounded** — `requestedQty ≤ heldQty` inclusive — `INSUFFICIENT_POSITION`.
4. **Candle freshness, target symbol only** — `STALE_CANDLE_DATA`.
5. **State confirmability** — `RISK_UNCONFIRMED`, unconditionally fail-closed even here.

Once C1–C5 all pass, a close always fills — there is no risk-budget rule downstream of C5 for a close. The valuation-observation attempt (§10) therefore happens exactly once, only for a close about to fill, never for one rejected by C1–C5.

---

## 13. Idempotency design

Scope: `PaperOrder` on `(paperAccountId, idempotencyKey)`; `PaperCommand` on `(paperAccountId, commandType, idempotencyKey)`. Two-stage resolution per §7 applies uniformly to all four command types: `ORDER` (BUY and close share the same `PaperOrder` mechanism, distinguished by `side`), `RESET`, `EMERGENCY_STOP_ACTIVATE`, `EMERGENCY_STOP_RESUME`.

**Canonical payload:** sorted-key JSON, Decimal values as fixed 8dp strings, UTF-8, no whitespace, SHA-256 hex, versioned via `hashVersion`.
- Order: `{commandType:"ORDER", side, symbol, normalizedQuantity, expectedGeneration}`.
- Reset: `{commandType:"RESET", expectedGeneration}`.
- Stop: `{commandType:"EMERGENCY_STOP_ACTIVATE"|"...RESUME", expectedGeneration, reason?}`.

**Order replay** reconstructs from the immutable `PaperOrder`+`PaperFill` join only — `orderId`, `status`, `side`, `symbol`, `requestedQuantity`, `reasonCode`, `reason`, and for `FILLED`: `fill.quantity`, `fill.price`, `fill.referenceMark`, `fill.fee`, `fill.notional`, `fill.allocatedCostBasis`, `fill.realizedPnl`, `fill.executedAt`. Never a current account balance, current position, current signal, or current timestamp.

**Command replay** returns `PaperCommand.resultJson` verbatim, frozen at write time, versioned by `resultSchemaVersion`:
- RESET: `{ oldPaperAccountId, oldGeneration, newPaperAccountId, newGeneration, archivedAt, emergencyStopCarriedForward }`.
- EMERGENCY_STOP_ACTIVATE: `{ paperAccountId, isActive: true, reason, activatedAt, activatedByUserId }`.
- EMERGENCY_STOP_RESUME: `{ paperAccountId, isActive: false, resumedAt, resumedByUserId }`.

Same key + same payload → replay verbatim, zero writes. Same key + different payload → 409, zero writes.

---

## 14. Reset and Emergency Stop

Reset carries an active Emergency Stop forward into the new generation unchanged (never auto-resumed); resuming always requires a separate explicit authenticated call. `RiskProfile` always reseeds to defaults on reset (not safety-relevant to carry).

Race outcomes: whichever request acquires the account lock first commits; the other, on its own lock acquisition, either finds a generation mismatch (order vs. reset) or a freshly-active stop (order vs. Emergency Stop) and rejects accordingly — no separate coordination needed beyond the single account-row lock and `expectedGeneration` check already in the pipeline (§7).

---

## 15. API routes and DTOs

Every route independently calls `requireUser()` and `getOrCreateActivePaperAccount(userId)` itself.

**Reads** (bucket `paperRead`):
- `GET /api/trading-bot/paper/account` → `{ paperAccountId, generation, status, cashBalance, equity, equityAsOf, equityCompleteness:"COMPLETE"|"PARTIAL"|"UNKNOWN", totalExposure, observedPeakEquity, observedDrawdownPct, dailyRealizedPnl, dailyLossPct, emergencyStopActive, startingBalance }`. `cashBalance`, `observedPeakEquity`, and `dailyRealizedPnl` (default `"0.00000000"` if no day-row yet) are always known persisted values, never null merely because live valuation failed. `dailyLossPct` is null only while today's baseline is null. `equity`, `totalExposure`, `observedDrawdownPct` are null when the live read-only valuation can't be completed right now.
- `GET /api/trading-bot/paper/positions` → array of `{ symbol, quantity, costBasis, avgEntryPrice, currentMark, marketValue, unrealizedPnl, markAsOf, markStatus:"FRESH"|"UNAVAILABLE" }` — `symbol`/`quantity`/`costBasis`/`avgEntryPrice` always known; `currentMark`/`marketValue`/`unrealizedPnl`/`markAsOf` nullable, with per-symbol `markStatus`.
- `GET /api/trading-bot/paper/risk-profile` → the `RiskProfile` fields, read-only.
- `GET /api/trading-bot/paper/journal?cursor=&limit=&generation=` — paginated, cursor-based, `limit` default 25/max 100, optional `generation` filter (defaults to the current active generation).
- `GET /api/trading-bot/paper/audit?cursor=&limit=` — same pagination shape.

**Writes:**
- `POST /api/trading-bot/paper/orders` — `{ symbol, side:"BUY", requestedQuantity, expectedGeneration, idempotencyKey }` → order-replay DTO (§13).
- `POST /api/trading-bot/paper/positions/close` — `{ symbol, requestedQuantity, expectedGeneration, idempotencyKey }` → same shape, `side:"SELL"`.
- `POST /api/trading-bot/paper/emergency-stop` — `{ action:"activate"|"resume", reason?, expectedGeneration, idempotencyKey }` → `resultJson` + `idempotent`.
- `POST /api/trading-bot/paper/reset` — `{ confirm:true, expectedGeneration, idempotencyKey }` → `resultJson` + `idempotent`.

Every Decimal crossing the boundary is a fixed-8dp string, never a JSON number. `requestedQuantity` with more than 8 fractional digits → 400 `INVALID_QUANTITY_PRECISION`. A `409 GENERATION_MISMATCH` response body includes `currentActiveGeneration`.

---

## 16. Security

`requireUser()` independently in every route. New rate-limit buckets `paperRead`, `paperOrderWrite`, `paperReset`, `paperEmergencyStop` added to the existing `RateLimitBucket` union.

**Same-origin (exact):** `assertSameOriginMutation(request)` parses `Origin` and compares its normalized form (scheme + hostname + effective port) against a trusted, statically configured allowlist (`APP_ORIGINS` env var) — never derived from the request's own `Host` header. `Sec-Fetch-Site: same-origin` is consulted only when `Origin` is absent; if both are absent, reject (fail closed).

**Content-Type:** every mutating route requires `application/json`; anything else, including a missing header → 415.

**Provider timeout / circuit breaker:** the outside-transaction market-data fetch has its own bounded internal deadline (`raceWithDeadline`); timeout/failure → 503 `PROVIDER_UNAVAILABLE`, no mutation. A per-instance, in-memory rolling-failure counter trips after 3 consecutive provider failures, blocking new opening requests only — the circuit-breaker check is never evaluated on the close code path at all.

---

## 17. UI cutover

`/trading-bot` cuts over completely — the Phase 1 mock-account panel and its components are removed, not flagged or shown alongside the persistent one. New sections on the same page: account summary (generation badge, cash/equity/exposure with a freshness/completeness indicator), read-only risk-limit display, open-positions table, BUY order form with client-side precision/bounds validation, per-position close control, Emergency Stop control (state display, activate/resume behind confirm dialogs), Reset control (shows current generation, confirm dialog explaining history is preserved), paginated trade journal, paginated audit history.

`app/api/trading-bot/{account,orders,positions,positions/close}/route.ts` and `lib/trading-bot/{store,mock-broker,risk-engine,strategy}.ts` are **deleted**, not stubbed — a "410 Gone" stub still requires ongoing audit to prove it can never mutate state; deletion removes the hazard outright. There is exactly one reachable account system after cutover.

---

## 18. Persistent signal adapter

The persistent BUY pipeline includes a new `lib/paper-trading/strategy.ts`, ported from `lib/trading-bot/strategy.ts`'s `SignalEngineStrategy` responsibility: it wraps the existing, unmodified `lib/trading-signals/` engine (`buildSignalFromCandles`) to re-derive the canonical signal server-side at pipeline step 8 (§7). No client-supplied side, price, stop, confidence, or signal timestamp is ever trusted — identical guarantee to Phase 1–3, relocated into the new tree as part of the cutover.

---

## 19. Error-to-HTTP-status mapping

400 — validation failure, `INVALID_QUANTITY_PRECISION`. 401 — auth failure. 403 — same-origin/CSRF failure. 409 — `IdempotencyConflict`, `GENERATION_MISMATCH`, `SERIALIZATION_RETRY_EXHAUSTED` (distinct codes, all 409). 415 — missing/wrong Content-Type. 429 — rate limit, with `Retry-After`. 200 — a `REJECTED` order/close is a successful call, `status:"REJECTED"` in the body, never an HTTP error. 503 — `PROVIDER_UNAVAILABLE`. 500 — redacted, unhandled.

---

## 20. Safety boundary

The existing static safety-scan test's glob extends to `lib/paper-trading/**` and `app/api/trading-bot/paper/**`, with the same banned-identifier checks already used in Phase 1–3 (no `lib/exchanges/*` import, no credential/secret env-var reference, no signed-request/HMAC exchange-client code), plus: no live-order-placement endpoint referenced, no scheduler/cron/background-poller code in these trees, no leverage/margin/short-execution identifiers.

---

## 21. Test-database strategy

`TEST_DATABASE_URL` only, never `DATABASE_URL`; `TEST_DIRECT_DATABASE_URL` for `prisma migrate deploy` when pooled. Hard-fail before destructive work if the test URL is unset, resolves to the same database as `DATABASE_URL`, or the per-run schema wasn't created by this run. One internally-generated schema name applied to both the migration and test-client connections. Real `prisma migrate deploy`, never `db push`. Genuine parallel connections for concurrency tests, never mocks. `DROP SCHEMA ... CASCADE` in `finally`, unconditionally. Credentials never logged. Separate, explicit, mandatory-before-acceptance command.

---

## 22. Testing strategy summary

Every rule in §11/§12 at its exact boundary; the pricing parity test (§8); the zero-equity and stop-direction tests (§11); the daily-P&L-preservation-through-PARTIAL-close test and the rejected-before-rule-13 baseline/peak test (§10); the concurrent-bootstrap test (§5.2); the five replay tests with the provider mocked to throw (§7); the `PaperFill`/`PaperTradeJournal` cross-account rejection tests (§4.4); the six append-only-trigger tests (§4.5); the `FILLED`-has-one-fill/`REJECTED`-has-none structural test; every new CHECK constraint introspection-verified; concurrent BUYs, concurrent closes, reset racing an order, Emergency Stop racing an order, injected mid-transaction failure, negative-cash/oversell attempts, cross-user isolation, restart persistence — all against the real-Postgres integration harness (§21), never mocks.

---

## 23. Migration and rollback

One additive `prisma migrate dev --name phase4_paper_trading`, `--create-only` then hand-edited to append §4.3/§4.4/§4.5's raw SQL. Zero changes to any existing table, zero backfill. Before release / before any user data exists, a rollback migration may drop the new tables. After data exists, rollback means a forward-fix migration or a restore from a verified backup — this is a procedural rule (review gate, backup precondition), not a technical guarantee the schema provides, since privileged DDL can bypass any constraint.

---

## 24. Acceptance criteria

Every risk rule (§11/§12) has a passing boundary test; every concurrency/race scenario has a passing real-Postgres test; the daily-P&L-preservation, rejected-early-baseline, and concurrent-bootstrap tests all pass; cross-account and append-only-trigger tests pass; the pricing parity test passes; all five replay tests pass with zero provider invocations; every CHECK constraint is introspection-verified; full suite/typecheck/lint/build/extended-safety-scan pass; the real-DB integration suite is a mandatory, separately-run green gate; the old Phase 1 routes are confirmed deleted; manual authenticated checklist covers the full lifecycle, Emergency-Stop-survives-reset, a partial-valuation close, and same-origin/Content-Type rejection spot-checks.

---

## 25. Unresolved decisions requiring approval

None outstanding from this design pass — all prior open questions (concurrency mechanism, test database, naming, API cutover, risk-profile editability, averaging-down threshold, exposure-cap units, Emergency-Stop-across-reset, CSRF posture, reset idempotency mechanism) were resolved by explicit decisions across the brainstorming rounds and are incorporated above. No new unresolved decision was introduced by this correction pass.
