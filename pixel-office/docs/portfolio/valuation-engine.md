# Valuation Engine

Location: `lib/portfolio/*`. This is the correctness-critical core. The math (`valuation.ts`, `cost-basis.ts`, `milestones.ts`, the snapshot **mappers**) is written as **pure functions over plain inputs** — no DB, no network, no HTTP — so it is unit-tested in isolation. The DB-touching services (`portfolio-service.ts`, `snapshot-service.ts`, `recompute.ts`, `transactions.ts`, `milestone-service.ts`) are thin wrappers over that pure core.

All money is `Prisma.Decimal` (decimal.js), never a JS `number`. The only `number`s produced are presentational ratios (`ratioPct`).

## Cost-basis: the strategy-pattern seam

`Transaction` rows are the source of truth. A **`CostBasisStrategy`** replays an asset's whole ordered transaction list and produces the derived `Holding` numbers plus realized P&L:

```ts
interface CostBasisStrategy {
  readonly method: "AVERAGE_COST" | "FIFO" | "LIFO" | "SPECIFIC_LOT";
  compute(transactions: CostBasisTx[]): HoldingComputation;
}
```

`getCostBasisStrategy(method)` is the factory. **Phase 1 ships `AverageCostStrategy` only** — any other method throws `"Cost-basis method not implemented yet: <method>"` (it fails loudly rather than silently mis-computing basis with the wrong method). The `CostBasisMethod` enum, the `Portfolio.costBasisMethod` column, and the interface all exist so FIFO/LIFO/specific-lot can be added later **without touching callers** (`recompute`, valuation, routes) or migrating the schema — the transaction log already holds everything those methods would need.

### The average-cost algorithm (`AverageCostStrategy.compute`)

Transactions are sorted by `executedAt` ascending, then folded:

- **BUY:** `grossNative = quantity × executedPrice + fees`.
  - `totalNative += grossNative`; `totalThb += grossNative × fxRateUsdThb` (each tx uses its **own** FX snapshot).
  - `quantity += q`; `avgCostNative = totalNative / quantity`; `avgCostThb = totalThb / quantity`.
- **SELL:** guard `q ≤ held`, else throw `InsufficientQuantityError`.
  - Average cost per unit is **unchanged**. `realizedPnlNative += (executedPrice − avgCostNative) × q − fees`.
  - `quantity −= q`; totals re-derived from remaining quantity (`avgCost × quantity`).
  - When the position fully closes (`quantity == 0`), average cost resets to 0 so a later re-buy starts clean.
- **DIVIDEND / FEE:** cash events — **no effect** on quantity or average cost in Phase 1.

The result (`HoldingComputation`) carries `quantity`, `avgCostNative`, `avgCostThb`, `totalCostNative`, `totalCostThb`, and `realizedPnlNative` — all Decimal.

> `InsufficientQuantityError` propagates out of `recomputeHolding()` inside the write `$transaction`, so an over-sell rolls the **whole** transaction back and is surfaced by the route as HTTP `400`. The ledger never records a sell that would leave a negative position.

## FX-snapshot immutability

There are **two** FX regimes, and mixing them up would corrupt P&L:

- **Cost basis (THB)** uses `avgCostThb`, derived from each transaction's **immutable** `fxRateUsdThb` snapshot captured at execution. It is **never** re-valued at today's rate.
- **Market value (THB)** uses **today's** FX (`MarketDataService.getFxUsdThb()`), because a current valuation should reflect the current exchange rate.

So unrealized P&L in THB = (quantity × today's price × today's FX) − (quantity × avgCostThb). `valuation.ts` keeps these strictly separate; `toBase()` converts USD-native values at today's FX, while cost basis carries its historical FX baked in.

## Valuation flow (`portfolio-service.buildValuation`)

`buildValuation(ownedPortfolio, market?)`:

1. Loads `Holding` rows (+ `Asset`) for the portfolio.
2. Gets today's FX once (`market.getFxUsdThb()`).
3. For each holding, gets a current price via `market.getAssetPrice()` (cache → live → snapshot → mock; never throws) and runs the pure `valueHolding()`.
4. Aggregates via `computeTotals()` and sets an honest overall `source` via `aggregateSource()`.

`aggregateSource(priceSources)`: all sources live (`finnhub`/`coingecko`) → `"live"`; all degraded (`cache`/`mock`) → `"mock"`; mixed → `"partial"`; empty → `"live"`.

`computeTotals()` produces both THB totals (`costBasisBase`, `marketValueBase`, `unrealizedPnlBase`) and **USD totals** (`costBasisUsd`, `marketValueUsd`) — the latter summed only over USD-native holdings (all in-scope assets today).

`computeAllocation(valuations, by)` buckets `currentValueBase` by asset symbol (`by="asset"`) or asset class (`by="class"`), computes each slice's `pct` of the total, and sorts descending by value.

### Ownership is proven by type (F-06)

`buildValuation`, `loadMilestoneInputs`, and `capturePortfolioSnapshot` accept **only** an `OwnedPortfolio` — a branded `Portfolio & { readonly [OWNERSHIP_CHECKED]: true }`. That brand is a phantom type produced only by the tenancy choke point (`requireOwnedPortfolio` / `listOwnedPortfolios`) or, for internal system contexts, `asSystemOwnedPortfolio()`. It is a **compile error** to hand these compute helpers a raw id/portfolio that skipped the ownership gate. See `security-notes.md`.

## Dividend tax-drag seam

The mandate requires always accounting for dividend withholding tax (US ETF 15% with W-8BEN; REIT like `O` ~30%). This is implemented as a **pure seam**, not a schema column:

```ts
netDividend(gross, taxRatePct) => gross − gross × taxRatePct / 100
```

`valuation.ts` exposes `netDividend()`, and `HoldingValuationInput` carries an optional `dividendTaxRatePct`. **Phase 1 does not yet surface net-dividend figures in any endpoint** — the function and the optional field are the wired-in seam so income/yield reporting can be made truthful without a migration. (The design doc's proposed `Asset.dividendTaxRatePct` column was **not** built; the rate is passed in per-computation instead.)

## DCA milestones (`milestones.ts` + `milestone-service.ts`)

`computeMilestones(currentValueThb, milestones)` returns per-milestone `pct` (capped at 100), a live `reached` flag (`current ≥ target`), and `reachedAt` (only if a persisted `achievedAt` exists). `synthesizeMilestones(top = 1_000_000)` builds 25/50/75/100% checkpoints. `loadMilestoneInputs(ownedPortfolio)` returns explicit `DcaMilestone` rows if any exist, else the synthesized set — so the feature works with zero setup.

## Performance-snapshot capture and series (`snapshot-service.ts`)

Two deliberately-split responsibilities:

### Capture (write) — `capturePortfolioSnapshot(ownedPortfolio, market?)`

1. `buildValuation()` now.
2. `capturedAt = startOfUtcDay(valuation.asOf)`.
3. Round totals to `Decimal(20,2)` and **upsert** one `PortfolioValueSnapshot` per `(portfolioId, capturedAt)`.

Idempotent by construction: re-running the same UTC day overwrites that day's row via `@@unique([portfolioId, capturedAt])` — retries and backfills never duplicate. The stored `source` (`live`/`partial`/`mock`) records how trustworthy that day's valuation was.

**[CRON SEAM]** No scheduler exists in this codebase. The intended trigger is a once-daily job (Vercel Cron / a GitHub Action hitting an internal route) that, for each portfolio, loads the row server-side and brands it with `asSystemOwnedPortfolio()` before calling capture. Until then, capture is driven manually by `POST /api/portfolios/[id]/performance`. See `extension-guide.md` for wiring.

### Series (read) — `loadPerformanceSeries(portfolioId, {from,to,limit})`

Range-scans the composite `(portfolioId, capturedAt)` unique index (the `WHERE` and `ORDER BY capturedAt ASC` both ride it), then maps rows through the **pure** `toPerformanceSeries()`:

- primary `series`: `{ time: <unix seconds>, value: totalValueThb }`,
- parallel `costSeries` (`totalCostThb`) and `pnlSeries` (`unrealizedPnlThb`),
- `source` aggregated by `aggregateSnapshotSource()` (empty → `"mock"`; all `"live"` → `"live"`; all degraded → `"mock"`; else `"partial"`).

`time` is unix **seconds** (integer) because that is what TradingView Lightweight Charts expects. `value` is a decimal **string**.

## What is unit-tested vs. what is not

- **Pure, tested in isolation:** cost-basis average-cost math, `valueHolding`/`computeTotals`/`computeAllocation`/`aggregateSource`, `netDividend`, `computeMilestones`/`synthesizeMilestones`, `toPerformanceSeries`/`aggregateSnapshotSource`, `boundedDecimalString`, the rate limiter, `redactSecrets`. (56 tests pass.)
- **DB-touching, unverified live:** `recomputeHolding`, `recordTransaction`, `buildValuation`'s DB loads, `capturePortfolioSnapshot`/`loadPerformanceSeries` persistence — correct by inspection but not exercised against a live Neon DB at documentation time.
