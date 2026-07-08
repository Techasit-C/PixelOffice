# Portfolio API Reference

All endpoints live under `app/api/portfolios/**` and declare `export const runtime = "nodejs"` (Prisma cannot run on Edge).

## Conventions that apply to every endpoint

- **Authentication.** Every handler calls `requireUser()` first. It resolves the internal `User.id` from the Clerk session, provisioning a local `User` row on first sight. **No valid session (or Clerk unconfigured) → `401`.**
- **Tenant isolation.** Every `[id]` / `[txId]` is loaded through the tenancy choke point (`requireOwnedPortfolio` / `requireOwnedTransaction`), which filters by the caller's `userId`. **A resource owned by another user → `404`, never 403** (existence is not leaked). See `security-notes.md`.
- **Money is serialized as STRINGS.** Every monetary/quantity field in a response is a decimal **string** (e.g. `"1234.56"`), never a JSON number. Percentages (`*Pct`, `dcaPct`) are the *only* numeric money-adjacent fields — they are presentational ratios. The client formats strings and never does money math in the browser.
- **Request bodies** are validated with Zod (`lib/api/schemas.ts`). A validation failure → `400` with `{ error: "Validation failed", fieldErrors: {...} }`.
- **Honest `source` marker.** Read/valuation endpoints include `source: "live" | "partial" | "mock"` — `partial` when some assets fell back to cached/mock prices, `mock` when all did (or when there is no data). Never presents degraded data as live.

### Status codes

Mapped centrally in `lib/api/errors.ts` (`toErrorResponse`):

| Code | When |
|---|---|
| `200` | Success (GET, PATCH, DELETE) |
| `201` | Resource created (POST portfolio / transaction / performance capture) |
| `400` | Zod validation failure (incl. **over-precision** decimals — see `boundedDecimalString`), **or** a SELL exceeding the held quantity (`InsufficientQuantityError`) |
| `401` | No authenticated user / Clerk not configured (`Unauthorized`) |
| `404` | Portfolio or transaction not found **or not owned by the caller** (`NotFound`) |
| `409` | Duplicate resource — a Postgres unique-constraint violation (`P2002`). Body is a **generic** `{ "error": "Duplicate resource" }`; the constraint name/columns are never echoed. |
| `429` | Rate limit exceeded (`TooManyRequests`). Includes a **`Retry-After`** header (seconds). |
| `500` | Unhandled error. Body is a generic `{ "error": "Internal server error" }`; details are logged server-side, never returned. |

Error body shape: `{ "error": "<message>" }`, plus `fieldErrors` for Zod validation and an optional `details` for `HttpError`s that carry them.

### Rate-limit buckets

`enforceRateLimit(userId, bucket)` is keyed by the **internal `userId`** (never IP). Two buckets, each a fixed window (default 60s):

| Bucket | Default max/window | Applied to |
|---|---|---|
| `write` | 30 | `POST /api/portfolios`, `PATCH`/`DELETE /api/portfolios/[id]`, `POST`/`PATCH`/`DELETE` on transactions |
| `providerRead` | 60 | `GET /api/portfolios/[id]/valuation`, `GET` **and** `POST /api/portfolios/[id]/performance` |

> Not every read is rate-limited. `GET /api/portfolios` (list), `GET /api/portfolios/[id]`, `/holdings`, `/allocation`, `/milestones`, and `GET .../transactions` currently have **no** `enforceRateLimit` call, even though several of them price-fetch. See `security-notes.md` (residual limitations).

---

## `GET /api/portfolios`

List the caller's portfolios, each with a live value summary.

- **Auth:** required. **Rate-limited:** no. **Query/body:** none.
- **Response `200`:**

```jsonc
{
  "portfolios": [
    {
      "id": "clx...",
      "name": "Core DCA",
      "baseCurrency": "THB",
      "currentValueBase": "358120.50",      // THB market value (string)
      "unrealizedPnlBase": "42110.20",      // THB unrealized P&L (string)
      "dcaTargetAmount": "1000000",         // top milestone target (string)
      "dcaPct": 35.81,                       // number — progress %
      "source": "live"                       // "live" | "partial" | "mock"
    }
  ]
}
```

> Each summary triggers a full valuation + milestone computation per portfolio, so the list price-fetches for every portfolio (with cache/snapshot fallback).

## `POST /api/portfolios`

Create a portfolio.

- **Auth:** required. **Rate-limited:** `write`.
- **Body** (`createPortfolioSchema`):

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, 1–120 chars |
| `baseCurrency` | string | optional, 3–8 chars, defaults to `"THB"` |
| `costBasisMethod` | enum | optional, one of `AVERAGE_COST` \| `FIFO` \| `LIFO` \| `SPECIFIC_LOT`, defaults `AVERAGE_COST` |

- **Response `201`:** `{ "portfolio": PortfolioDTO }`

`PortfolioDTO = { id, name, baseCurrency, costBasisMethod, createdAt, updatedAt }` (dates ISO strings).

> Selecting a non-`AVERAGE_COST` method is accepted and stored, but the **first transaction write against that portfolio will fail** because the strategy is not implemented yet. See `valuation-engine.md`.

---

## `GET /api/portfolios/[id]`

Portfolio metadata + live-valued holdings.

- **Auth:** required. **Rate-limited:** no. `404` if not owned.
- **Response `200`:**

```jsonc
{
  "portfolio": { /* PortfolioDTO */ },
  "holdings": [ /* HoldingView[] */ ],
  "source": "live"
}
```

`HoldingView` (all money as strings):

```jsonc
{
  "assetSymbol": "VOO",
  "assetClass": "ETF",                 // AssetType: EQUITY | ETF | CRYPTO
  "quantity": "12.0000000000",
  "avgCostPerUnit": "410.25000000",    // native currency (USD)
  "totalCostBasis": "4923.00000000",   // native currency
  "currentPrice": "540.10000000",      // native currency
  "currentValueNative": "6481.20",     // native currency
  "currentValueBase": "213879.60",     // THB (today's FX)
  "unrealizedPnlNative": "1558.20",
  "unrealizedPnlBase": "51432.60",     // THB
  "unrealizedPnlPct": 31.65,            // number
  "priceSource": "finnhub"             // finnhub | coingecko | cache | mock
}
```

## `PATCH /api/portfolios/[id]`

Update a portfolio.

- **Auth:** required. **Rate-limited:** `write`. `404` if not owned.
- **Body** (`updatePortfolioSchema`, at least one field required): `name?` (1–120), `costBasisMethod?` (enum). *(`baseCurrency` is not editable here.)*
- **Response `200`:** `{ "portfolio": PortfolioDTO }`
- `400` if the body is empty (`"no fields to update"`).

## `DELETE /api/portfolios/[id]`

Delete a portfolio. Holdings, transactions, milestones, and value snapshots cascade-delete.

- **Auth:** required. **Rate-limited:** `write`. `404` if not owned.
- **Response `200`:** `{ "ok": true }`

---

## `GET /api/portfolios/[id]/holdings`

Live-valued holdings only.

- **Auth:** required. **Rate-limited:** no. `404` if not owned.
- **Response `200`:** `{ "holdings": HoldingView[], "source": "live" }`

---

## `GET /api/portfolios/[id]/transactions`

Paged ledger, newest first.

- **Auth:** required. **Rate-limited:** no. `404` if not owned.
- **Query:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `assetId` | string | — | filter to one asset |
| `limit` | number | 50 | clamped to **1–200** |
| `cursor` | string | — | transaction `id` to page after (keyset pagination) |

- **Response `200`:**

```jsonc
{
  "transactions": [ /* TransactionDTO[] */ ],
  "nextCursor": "clx..."   // omitted when there is no next page
}
```

`TransactionDTO`:

```jsonc
{
  "id": "clx...",
  "portfolioId": "clx...",
  "assetId": "clx...",
  "assetSymbol": "VOO",
  "assetType": "ETF",
  "type": "BUY",                    // BUY | SELL | DIVIDEND | FEE
  "quantity": "12.0000000000",
  "executedPrice": "410.25000000",
  "currency": "USD",
  "fxRateUsdThb": "33.10000000",    // immutable snapshot
  "fees": "0.99000000",             // string | null
  "executedAt": "2026-05-01T00:00:00.000Z",
  "source": "manual",               // string | null
  "externalId": null,               // string | null
  "createdAt": "2026-05-01T09:12:00.000Z"
}
```

## `POST /api/portfolios/[id]/transactions`

Record a transaction. The ledger insert **and** the derived Holding recompute run in **one `prisma.$transaction`**, so the cache can never drift. The asset is resolved/created by `(symbol, assetType)`.

- **Auth:** required. **Rate-limited:** `write`. `404` if not owned.
- **Body** (`createTransactionSchema`):

| Field | Type | Rules |
|---|---|---|
| `assetSymbol` | string | required, 1–20 chars (upper-cased server-side) |
| `assetType` | enum | required: `EQUITY` \| `ETF` \| `CRYPTO` |
| `type` | enum | required: `BUY` \| `SELL` \| `DIVIDEND` \| `FEE` |
| `quantity` | decimal-string | required; parseable **finite, non-negative** Decimal; **≤ 10 dp, ≤ 20 integer digits** (`Decimal(30,10)`) |
| `executedPrice` | decimal-string | required; ≤ 8 dp, ≤ 12 integer digits (`Decimal(20,8)`) |
| `currency` | string | optional, 3–8 chars, defaults `"USD"` |
| `fxRateUsdThb` | decimal-string | **optional** — if omitted, the handler snapshots the **current live FX rate now** and stores it immutably; ≤ 8 dp, ≤ 10 integer digits (`Decimal(18,8)`) |
| `fees` | decimal-string | optional; ≤ 8 dp, ≤ 12 integer digits |
| `executedAt` | date | required (`z.coerce.date()` — ISO string ok) |
| `source` | string | optional, ≤40 chars (defaults to `"manual"` at persist time) |
| `externalId` | string | optional, ≤120 chars (import dedupe id) |
| `assetName` | string | optional, ≤120 chars |

- **Response `201`:**

```jsonc
{
  "transaction": { /* TransactionDTO */ },
  "holding": { /* HoldingView — the affected holding, freshly priced */ }
}
```

- `400` (`"Cannot sell N units; only M held"`) if a SELL exceeds the held quantity — the whole transaction rolls back, so the ledger never records an over-sell.
- `400` if any decimal exceeds its column's precision/scale (fails in Zod as a validation error, not as a DB `500`).
- `409` if `(portfolioId, source, externalId)` collides with an existing row (idempotent import dedupe). Manual rows (null `externalId`) never collide.

---

## `PATCH /api/portfolios/[id]/transactions/[txId]`

Edit a single ledger row and recompute its holding atomically.

- **Auth:** required. **Rate-limited:** `write`. `404` if the portfolio **or** the transaction is not owned.
- **Body** (`updateTransactionSchema` — a partial of the create body, at least one field). **Only mutable fields are applied:** `type`, `quantity`, `executedPrice`, `currency`, `fxRateUsdThb`, `fees`, `executedAt`. **Asset identity/symbol is NOT editable** — to move to a different asset, create a new transaction.
- **Response `200`:**

```jsonc
{
  "transaction": { /* TransactionDTO */ },
  "holding": { /* HoldingView | null */ },   // null if no market price yet
  "holdingQuantity": "12.0000000000"         // recomputed qty as a string
}
```

## `DELETE /api/portfolios/[id]/transactions/[txId]`

Delete a ledger row and recompute the affected holding atomically.

- **Auth:** required. **Rate-limited:** `write`. `404` if not owned.
- **Response `200`:** `{ "ok": true, "holdingQuantity": "10.0000000000" }`

---

## `GET /api/portfolios/[id]/valuation`

Live-valued totals + holdings.

- **Auth:** required. **Rate-limited:** `providerRead`. `404` if not owned.
- **Response `200`:**

```jsonc
{
  "asOf": "2026-07-06T10:00:00.000Z",
  "fxRate": "33.05000000",             // USD->THB used for market value
  "fxSource": "live",                   // "live" | "cache" | "mock"
  "totals": {
    "costBasisBase": "316000.00",       // THB, from immutable per-tx FX
    "marketValueBase": "358120.50",     // THB, today's FX
    "unrealizedPnlBase": "42120.50",    // THB
    "unrealizedPnlPct": 13.33,          // number
    "costBasisUsd": "9550.00",          // USD-native holdings only
    "marketValueUsd": "10830.00"
  },
  "holdings": [ /* HoldingView[] */ ],
  "source": "live"
}
```

## `GET /api/portfolios/[id]/allocation`

Allocation slices; `pct` sums to ~100.

- **Auth:** required. **Rate-limited:** no. `404` if not owned.
- **Query:** `by=asset` (default) or `by=class`. Any other value falls back to `asset`.
- **Response `200`:**

```jsonc
{
  "asOf": "2026-07-06T10:00:00.000Z",
  "by": "asset",
  "slices": [
    { "key": "VOO", "label": "VOO", "marketValueBase": "213879.60", "pct": 59.7 }
  ],
  "source": "live"
}
```

Slices are sorted by market value descending.

## `GET /api/portfolios/[id]/milestones`

DCA progress toward the top target (default ฿1,000,000).

- **Auth:** required. **Rate-limited:** no. `404` if not owned.
- **Response `200`:**

```jsonc
{
  "target": "1000000",                 // top milestone (string)
  "currentValueBase": "358120.50",     // current THB market value (string)
  "pct": 35.81,                         // progress toward top target (number, capped 100)
  "milestones": [
    {
      "label": "฿250000",
      "targetAmount": "250000",         // string
      "pct": 100,                        // number, capped 100
      "reached": true,                   // current >= target
      "reachedAt": "2026-03-01T00:00:00.000Z"   // ISO, only if persisted; else omitted
    }
  ],
  "source": "live"
}
```

If a portfolio has no `DcaMilestone` rows, 25/50/75/100% checkpoints of ฿1,000,000 are synthesized on the fly. `reached` is computed live from current value; `reachedAt` only appears for persisted rows whose `achievedAt` was stamped.

---

## `GET /api/portfolios/[id]/performance`

Historical portfolio-value time series, shaped for TradingView Lightweight Charts. Reads persisted `PortfolioValueSnapshot` rows — it does **not** re-price live (GET is a pure read of stored history).

- **Auth:** required. **Rate-limited:** `providerRead`. `404` if not owned.
- **Query** (`performanceQuerySchema`, all optional):

| Param | Type | Notes |
|---|---|---|
| `from` | date | ISO date; lower bound on `capturedAt` (inclusive) |
| `to` | date | ISO date; upper bound (inclusive). `400` if `from > to`. |
| `limit` | number | positive integer, **≤ 5000**; caps returned points |

- **Response `200`:**

```jsonc
{
  "series":     [ { "time": 1751760000, "value": "358120.50" } ],  // total value (THB)
  "costSeries": [ { "time": 1751760000, "value": "316000.00" } ],  // cost basis (THB)
  "pnlSeries":  [ { "time": 1751760000, "value": "42120.50"  } ],  // unrealized P&L (THB)
  "source": "live"   // "live" | "partial" | "mock" — aggregated from per-row markers
}
```

- `time` is **unix seconds** (integer); `value` is a decimal **string**. Points are ordered ascending by `capturedAt`.
- `source` for the series: all rows `"live"` → `"live"`; all degraded → `"mock"`; empty series → `"mock"`; otherwise `"partial"`.

## `POST /api/portfolios/[id]/performance`

Manually capture **today's** snapshot (UTC day). This is the manual trigger that stands in for the not-yet-built daily cron (see `architecture.md` and `valuation-engine.md`). It values the whole portfolio now (hitting the provider layer) and **upserts** one row per `(portfolioId, capturedAt)`, so re-running the same day overwrites rather than duplicates.

- **Auth:** required. **Rate-limited:** `providerRead`. `404` if not owned.
- **Body:** none.
- **Response `201`:** `{ "ok": true, "capturedAt": "2026-07-06T00:00:00.000Z" }` (`capturedAt` is the start of the UTC day).
