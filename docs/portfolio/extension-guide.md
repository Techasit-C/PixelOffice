# Extension Guide

How to extend the Portfolio module along its five built-in seams. Each seam was designed so the change is local — you should not need to touch route handlers or the schema for most of these.

## 1. Add a cost-basis method (FIFO / LIFO / specific-lot)

The strategy pattern is already in place; only the algorithm is missing.

1. Implement `CostBasisStrategy` in `lib/portfolio/cost-basis.ts` (or a new file), e.g. `class FifoStrategy implements CostBasisStrategy`. Set `method = "FIFO"` and implement `compute(transactions: CostBasisTx[]): HoldingComputation`. Keep it **pure** (no DB/network) — replay the ordered transaction list into `quantity`, `avgCostNative`, `avgCostThb`, `totalCostNative`, `totalCostThb`, `realizedPnlNative`, all `Decimal`. Reuse the money helpers (`D`, `ZERO`, `Decimal` ops); track native and THB in parallel using each tx's **own** `fxRateUsdThb` snapshot.
2. Register it in `getCostBasisStrategy(method)` — add a `case "FIFO": return new FifoStrategy();`. (Today the `default` throws `"Cost-basis method not implemented yet"`.)
3. **No schema change** — `CostBasisMethod` already has all four enum values, `Portfolio.costBasisMethod` already stores the choice, and the transaction log already holds everything FIFO/LIFO/specific-lot need. `recomputeHolding` already passes `portfolio.costBasisMethod` through.
4. **No route change** — `POST /api/portfolios` already accepts and stores the method; `recordTransaction` already threads it into recompute.
5. Add unit tests alongside the existing average-cost tests (this is the highest-value coverage — the math is pure).

> Specific-lot additionally needs a way to *select which lot* a SELL closes. The current `CostBasisTx` shape has no lot-id; you would extend it (and the row→tx mapping in `recompute.ts`) to carry a lot reference. That is the one case that touches more than the strategy file.

## 2. Add an asset type

1. Add the value to the `AssetType` enum in `prisma/schema.prisma` and generate a migration (`prisma migrate dev` against `DIRECT_URL`).
2. Add it to the Zod `assetType` enum in `lib/api/schemas.ts`.
3. Give it a price path in the provider layer: either extend an existing provider's supported types or add a new provider (see §4) and route it in `RoutingProvider.getQuote`.
4. Confirm currency handling in `valuation.ts` `toBase()` — today anything non-`THB` is treated as USD-quoted. If the new type quotes in another currency, extend `toBase()` and the USD-totals filter in `computeTotals()`.
5. Update UI enums/labels in `components/portfolio/*` and `types/portfolio.ts` as needed.

## 3. Add a market-data provider

Covered in depth in `provider-layer.md` ("Adding a new provider"). In short: implement `MarketDataProvider` (throw on failure, read keys lazily, prefer header auth, build prices via `toDecimal`), add a `PriceSource` value if the provenance is new, wire it into `RoutingProvider` (constructor injection — no edit to `MarketDataService`), and re-export from `index.ts`. Callers change nothing.

## 4. Add a metric or endpoint

Follow the existing handler shape so security and serialization stay consistent.

1. **Put the math in `lib/portfolio/` as a pure function** over plain inputs (this is the boundary the QA gate depends on). Reuse `buildValuation()` if you need priced holdings.
2. **New route file** under `app/api/portfolios/[id]/<name>/route.ts`. Copy the skeleton from an existing handler:
   ```ts
   export const runtime = "nodejs";           // Prisma cannot run on Edge
   export async function GET(request: Request, { params }: Ctx) {
     try {
       const { id } = await params;           // params is a Promise
       const { userId } = await requireUser(); // 401 if unauth
       enforceRateLimit(userId, "providerRead"); // if it price-fetches
       const portfolio = await requireOwnedPortfolio(userId, id); // 404 if not owned → OwnedPortfolio
       // ... build result, serialize Decimals to strings ...
       return NextResponse.json(result);
     } catch (err) {
       return toErrorResponse(err);           // central error → HTTP mapping
     }
   }
   ```
3. **Serialize every Decimal to a string** at the boundary (`.toString()` / `money.ts` `toStr` / a serializer in `lib/api/serialize.ts`). Only presentational percentages may be numbers.
4. **Rate-limit provider-hitting handlers** with `enforceRateLimit(userId, "providerRead")` (or `"write"` for mutations). Note the residual gap in `security-notes.md` — provider-hitting reads should be limited.
5. **Validate query/body with Zod** in `lib/api/schemas.ts`; use `boundedDecimalString(precision, scale)` for any new money field so over-precision fails as `400`.
6. Add a typed client wrapper in `lib/portfolio-client/api.ts` and a hook in `hooks.ts` if the UI consumes it, and a DTO in `types/portfolio.ts` / `lib/portfolio-client/types.ts`.
7. Document it in `api-reference.md`.

## 5. Wire the snapshot cron

The capture logic is complete and idempotent; only the scheduler is missing. `capturePortfolioSnapshot(ownedPortfolio)` upserts one row per `(portfolioId, capturedAt=start-of-UTC-day)`, so running it repeatedly is safe.

To automate daily capture after US market close:

1. **Create an internal trigger route**, e.g. `app/api/internal/capture-snapshots/route.ts` (`runtime = "nodejs"`). Protect it with a shared secret from the scheduler (a header checked against an env var) — this route is **not** user-authenticated.
2. In the handler, **load every portfolio server-side** (an unscoped `prisma.portfolio.findMany()` is legitimate here — it is a system context, not a per-user request), and for each, brand it with `asSystemOwnedPortfolio(p)` (from `lib/auth/tenancy.ts`) before calling `capturePortfolioSnapshot(branded)`. The brand is the type-level proof the compute helpers require; `asSystemOwnedPortfolio` exists exactly for this internal path.
3. **Schedule it.** For Vercel, add a Cron entry (e.g. daily) hitting that route; for GitHub Actions, a scheduled workflow that curls it with the shared secret. Prefer a time after US market close so prices are settled.
4. Because capture is a `providerRead`-class workload that prices every portfolio, watch upstream provider quotas; the in-memory price cache does **not** span cron invocations on cold instances.
5. Until the cron exists, `POST /api/portfolios/[id]/performance` is the manual capture path and populates the same table the same way.

> **Do not** call `asSystemOwnedPortfolio` in a user-facing request handler — that bypasses the per-user ownership gate. It is only for internal, unauthenticated, all-portfolios contexts like this cron.
