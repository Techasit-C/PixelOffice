# Database Model

Source: `prisma/schema.prisma` (Neon PostgreSQL). Committed DDL: `prisma/migrations/0_init/migration.sql` and `prisma/migrations/1_perf_and_tenant_uniqueness/migration.sql`.

> **Data-integrity contract (from the schema header):**
> - `Transaction` is the **source of truth** (append-mostly ledger).
> - `Holding` is a **derived cache**, recomputed from the transaction log inside the same DB transaction as each write.
> - Every monetary/quantity field is `Decimal` with explicit precision — **never `Float`**.
> - `Transaction.fxRateUsdThb` is an **immutable** snapshot; historical THB cost basis always uses the stored rate, never today's rate.
> - Tenant isolation runs through `Portfolio.userId`; every portfolio-scoped row is reachable to a `userId` via its portfolio.

## Entity relationships

```
User ──1:N──► Portfolio ──1:N──► Transaction ──N:1──► Asset
                     ├──1:N──► Holding      ──N:1──► Asset
                     ├──1:N──► DcaMilestone
                     └──1:N──► PortfolioValueSnapshot
Asset ──1:N──► PriceSnapshot
```

- `User` is keyed by Clerk (`clerkUserId`) and stores **no credentials**.
- `Asset` and `PriceSnapshot` are **shared reference data** — no user scoping (they hold no private data). The same symbol may exist across types, so asset identity is `(symbol, assetType)`, not `symbol` alone.

## Enums

| Enum | Values |
|---|---|
| `AssetType` | `EQUITY`, `ETF`, `CRYPTO` |
| `TransactionType` | `BUY`, `SELL`, `DIVIDEND`, `FEE` |
| `CostBasisMethod` | `AVERAGE_COST`, `FIFO`, `LIFO`, `SPECIFIC_LOT` (only `AVERAGE_COST` implemented) |

## Tables

### `users` (`User`)
| Field | Type | Notes |
|---|---|---|
| `id` | `cuid` PK | internal tenant key used by all portfolio queries |
| `clerkUserId` | text, **unique** | external identity from Clerk |
| `email` | text, **unique** | stores a deterministic placeholder `${clerkUserId}@clerk.local`, **not** the real Clerk email — see the security note below |
| `displayName` | text? | derived from Clerk first/last name |
| `createdAt` / `updatedAt` | timestamp | |

> **Placeholder email (CR-003 F-05).** `email` is a `UNIQUE` column, but Clerk does **not** guarantee email uniqueness across accounts (and may not expose a real email at all). Writing a real email risks a `P2002` unique-violation that locks a legitimate user out of provisioning. `requireUser()` therefore **always** stores the guaranteed-unique placeholder `${clerkUserId}@clerk.local`; Clerk remains the source of truth for the real address.

### `portfolios` (`Portfolio`) — tenant root
| Field | Type | Notes |
|---|---|---|
| `id` | `cuid` PK | |
| `userId` | text FK → `users.id` | `onDelete: Cascade` |
| `name` | text | |
| `baseCurrency` | text | default `"THB"` |
| `costBasisMethod` | `CostBasisMethod` | default `AVERAGE_COST` |
| `createdAt` / `updatedAt` | timestamp | |

Index: `@@index([userId])` — "list my portfolios" is one indexed lookup.

### `assets` (`Asset`) — shared reference data
| Field | Type | Notes |
|---|---|---|
| `id` | `cuid` PK | |
| `symbol` | text | e.g. `"VOO"`, `"BTC"` (stored upper-cased) |
| `name` | text | |
| `assetType` | `AssetType` | |
| `currency` | text | native quote currency, default `"USD"` |

Constraint: `@@unique([symbol, assetType])`. Referenced by `Transaction`/`Holding` with `onDelete: Restrict` (a referenced asset cannot be deleted).

### `transactions` (`Transaction`) — SOURCE OF TRUTH
| Field | Type (`@db`) | Notes |
|---|---|---|
| `id` | `cuid` PK | |
| `portfolioId` | FK → `portfolios.id` | `onDelete: Cascade` |
| `assetId` | FK → `assets.id` | `onDelete: Restrict` |
| `type` | `TransactionType` | |
| `quantity` | `Decimal(30,10)` | 0 valid for DIVIDEND/FEE; 10 dp covers crypto sub-satoshi lots |
| `executedPrice` | `Decimal(20,8)` | per-unit, in `currency` |
| `currency` | text | native currency of price/fees |
| `fxRateUsdThb` | `Decimal(18,8)` | **immutable** USD→THB snapshot at execution |
| `fees` | `Decimal(20,8)?` | null = not recorded |
| `executedAt` | timestamp | user-supplied economic event time (ordering key for replay) |
| `source` | text? | e.g. `"manual"`, `"mexc"` — future auto-import |
| `externalId` | text? | provider fill id, for idempotent import dedupe |
| `createdAt` / `updatedAt` | timestamp | |

Indexes: `@@index([portfolioId, assetId])`, `@@index([portfolioId, executedAt])`, `@@index([assetId])`.

**Unique constraint (tenant-scoped):** `@@unique([portfolioId, source, externalId])`. Import idempotency is **per-portfolio** — see [Unique constraints](#the-two-unique-constraints) below. Postgres exempts `NULL`s from unique indexes, so manual rows (null `externalId`) never collide.

### `holdings` (`Holding`) — DERIVED CACHE
| Field | Type (`@db`) | Notes |
|---|---|---|
| `id` | `cuid` PK | |
| `portfolioId` | FK → `portfolios.id` | `onDelete: Cascade` |
| `assetId` | FK → `assets.id` | `onDelete: Restrict` |
| `quantity` | `Decimal(30,10)` | current net position (matches `Transaction.quantity`) |
| `avgCostNative` | `Decimal(20,8)` | average cost per unit, native currency |
| `avgCostThb` | `Decimal(20,8)` | average cost per unit in THB (from per-tx FX snapshots) |
| `updatedAt` | timestamp | |

Constraint: `@@unique([portfolioId, assetId])` (one cached row per portfolio+asset). Indexes: `@@index([portfolioId])`, `@@index([assetId])`.

> Never hand-edit `Holding`. It is rebuilt exclusively by `recomputeHolding()` (`lib/portfolio/recompute.ts`) inside the same `$transaction` as the ledger write.

### `price_snapshots` (`PriceSnapshot`) — price cache + fallback
| Field | Type (`@db`) | Notes |
|---|---|---|
| `id` | `cuid` PK | |
| `assetId` | FK → `assets.id` | `onDelete: Cascade` |
| `price` | `Decimal(20,8)` | |
| `currency` | text | usually `"USD"` |
| `source` | text | `"finnhub"` \| `"coingecko"` \| `"cache"` \| `"mock"` |
| `fetchedAt` | timestamp | default now |

Index: `@@index([assetId, fetchedAt])` — latest price per asset is `ORDER BY fetchedAt DESC` on this composite index.

### `dca_milestones` (`DcaMilestone`) — progress checkpoints
| Field | Type (`@db`) | Notes |
|---|---|---|
| `id` | `cuid` PK | |
| `portfolioId` | FK → `portfolios.id` | `onDelete: Cascade` |
| `targetThb` | `Decimal(20,2)` | e.g. `1000000.00` |
| `currentThb` | `Decimal(20,2)` | default 0; last-computed progress |
| `achievedAt` | timestamp? | set when `currentThb` first crosses `targetThb`; null = not yet |
| `createdAt` / `updatedAt` | timestamp | |

Index: `@@index([portfolioId])`.

> If no `DcaMilestone` rows exist for a portfolio, the milestones endpoint synthesizes 25/50/75/100% checkpoints of ฿1,000,000, so the feature works with zero setup.

### `portfolio_value_snapshots` (`PortfolioValueSnapshot`) — value time series
Backs the historical performance chart. One snapshot per `(portfolio, capturedAt)` instant.

| Field | Type (`@db`) | Notes |
|---|---|---|
| `id` | `cuid` PK | |
| `portfolioId` | FK → `portfolios.id` | `onDelete: Cascade` |
| `capturedAt` | timestamp | the **economic instant** the valuation represents (charts plot on this), distinct from `createdAt` (row write time). The capture service truncates to the **start of the UTC day**. |
| `totalValueThb` | `Decimal(20,2)` | already-rounded portfolio total (finer precision stays upstream in Transaction/Holding) |
| `totalValueUsd` | `Decimal(20,2)` | |
| `totalCostThb` | `Decimal(20,2)` | |
| `unrealizedPnlThb` | `Decimal(20,2)` | signed: `totalValueThb - totalCostThb` |
| `source` | text | `"live"` \| `"partial"` \| `"mock"` — how trustworthy the valuation was, so the chart can flag stale points |
| `createdAt` | timestamp | default now |

Constraint: `@@unique([portfolioId, capturedAt])`. **No separate `@@index([portfolioId, capturedAt])` is declared** — the unique constraint already creates a btree index on exactly those columns in that order, which the planner uses for both the `portfolioId` filter and the `capturedAt` range/`ORDER BY`. A separate index would be a redundant duplicate written on every insert, so it is intentionally omitted.

## The two unique constraints (why they are scoped as they are)

1. **`transactions` — `@@unique([portfolioId, source, externalId])`** (CR-003 F-01). Import idempotency is **per-portfolio (tenant-scoped)**. The original `0_init` migration created a **global** `(source, externalId)` unique index; migration `1_perf_and_tenant_uniqueness` **drops it and recreates it scoped by `portfolioId`**. A global constraint let one tenant squat a provider fill-id and block/probe another tenant's import (a cross-tenant DoS + existence oracle). Scoping to the portfolio keeps dedupe within the tenant. A `P2002` violation surfaces as HTTP `409` `"Duplicate resource"` (generic — the constraint is never echoed).

2. **`portfolio_value_snapshots` — `@@unique([portfolioId, capturedAt])`** (CR-004). One snapshot per portfolio per instant, making daily capture **idempotent**: retries/backfills upsert the same `(portfolioId, capturedAt)` row rather than inserting duplicates.

## Why Decimal, and the precision choices

Floats silently corrupt cost basis and P&L (`0.1 + 0.2 !== 0.3`), so **every** monetary/quantity column is Postgres `DECIMAL`, mapped to `Prisma.Decimal` (decimal.js) in code. Nothing does money math as a JS `number`; the only numbers that cross the wire are presentational percentages.

| Column kind | Precision | Rationale |
|---|---|---|
| Quantities (`quantity`) | `Decimal(30,10)` | 10 dp handles crypto sub-satoshi lots without drift; wide integer part for large share counts |
| Prices / costs / fees | `Decimal(20,8)` | 8 dp covers cheap crypto and high-priced equities alike |
| FX rate | `Decimal(18,8)` | USD→THB with 8 dp precision |
| THB target/progress + snapshot totals | `Decimal(20,2)` | fiat baht amounts, 2 dp; 18 integer digits handle any realistic portfolio total |

The Zod layer (`boundedDecimalString`, `lib/api/schemas.ts`) enforces these exact precision/scale bounds on input, so an over-precision value fails as a `400` validation error rather than a Postgres "numeric field overflow" `500`. Serialization to a string happens once, at the API boundary (`lib/api/serialize.ts` and `money.ts` `toStr`), so the wire never carries a truncated float.

## Migrations

| Migration | Contents |
|---|---|
| `0_init` | All base tables/enums/indexes. Per its header, generated offline and **never applied to any DB**; the *global* `transactions(source, externalId)` unique index is created here. |
| `1_perf_and_tenant_uniqueness` | Drops the global transaction unique index and recreates it as `transactions(portfolioId, source, externalId)`; creates `portfolio_value_snapshots` (+ its unique index and FK). Both changes are safe on the greenfield/empty schema. |

Applying them (`prisma migrate deploy`) needs a live `DIRECT_URL` (unpooled). See the README.
