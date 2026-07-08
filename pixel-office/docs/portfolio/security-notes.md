# Security Notes

This records the security posture of the Portfolio module as **implemented**, including the completed remediation (CR-003 findings F-01…F-06) and the **honest residual limitations**. It is a reference for reviewers and for anyone extending the module.

## Threat model in one line

A per-user, multi-tenant feature bolted onto an otherwise single-purpose dashboard: the dominant risk is **one tenant reading or corrupting another tenant's data**, followed by resource abuse (quota exhaustion) and secret leakage.

## Controls in place

### 1. Tenant isolation via a branded-type choke point (F-06)

Every portfolio-scoped read/write goes through `lib/auth/tenancy.ts`. Its helpers **always** take `userId`, so an unscoped query is impossible to write by accident:

- `requireOwnedPortfolio(userId, id)` / `requireOwnedTransaction(userId, id, txId)` / `listOwnedPortfolios(userId)`.
- They return a **branded `OwnedPortfolio`** type (`Portfolio & { readonly [OWNERSHIP_CHECKED]: true }`). The portfolio-scoped compute helpers (`buildValuation`, `loadMilestoneInputs`, `capturePortfolioSnapshot`) accept **only** this branded type. Feeding them a raw id/portfolio that skipped the ownership gate is a **compile error** — defense-in-depth beyond the runtime check.
- The only way to produce the brand without a per-user check is `asSystemOwnedPortfolio()`, explicitly reserved for internal unauthenticated contexts (the future daily cron) and never called in a request handler.

### 2. IDOR → 404 (not 403)

An ownership mismatch throws `NotFound` (`404`), never `403`. This does not leak that another user's portfolio/transaction exists. Every `[id]`/`[txId]` route resolves ownership through the choke point before doing anything else.

### 3. Auth fails closed

`requireUser()` resolves the internal `User.id` from the Clerk session. If Clerk is unconfigured or `auth()` throws, or there is no `userId`, it throws `Unauthorized` (`401`) — it never falls through to a `500` or an unauthenticated success. `middleware.ts` passes through when Clerk keys are absent precisely so the handlers can return JSON `401` rather than an HTML redirect. Missing keys ⇒ everything is `401`, which is the safe default.

### 4. Placeholder email (F-05)

`User.email` is a `UNIQUE` column, but Clerk does not guarantee email uniqueness (and may not expose a real email). Storing a real email risked a `P2002` on provisioning that could lock out a legitimate user (a DoS / takeover-adjacent hazard). `requireUser()` therefore **always** writes the deterministic, guaranteed-unique placeholder `${clerkUserId}@clerk.local`. Provisioning uses `upsert` on `clerkUserId` to also survive the concurrent-first-request race.

### 5. Input validation: Zod + bounded decimals (F-03)

Every write body is validated by a Zod schema (`lib/api/schemas.ts`). Money/quantity fields go through `boundedDecimalString(precision, scale)`, which rejects:

- non-parseable, `NaN`/`Infinity`, and **negative** values,
- **over-scale** values (more decimal places than the column holds — would be silently rounded by the DB),
- **over-magnitude** values (more integer digits than the column holds — would be a Postgres numeric overflow).

So an over-precision decimal fails as a `400` here instead of becoming a `500` at the DB. Business-rule validation (no sell exceeding holdings) is enforced in the engine (`InsufficientQuantityError` → `400`), with the whole write rolled back.

### 6. Error non-leakage

`toErrorResponse()` (`lib/api/errors.ts`) is the single mapper. It never returns stack traces. Unhandled errors become a generic `{ "error": "Internal server error" }` (`500`) with the real error logged server-side only.

### 7. `P2002` → 409, generic body (F-01)

A Postgres unique-constraint violation maps to `409 { "error": "Duplicate resource" }`. The constraint name and columns are **never** echoed — that would leak schema and cross-tenant hints. Combined with the tenant-scoped `transactions(portfolioId, source, externalId)` unique index (migration `1_perf_and_tenant_uniqueness`), import idempotency is per-portfolio, closing the cross-tenant squat/probe (DoS + existence oracle) that a global `(source, externalId)` constraint allowed.

### 8. Per-user rate limiting (F-02)

`enforceRateLimit(userId, bucket)` (`lib/api/rate-limit.ts`) keys on the **internal `userId`** (never IP), so one user cannot exhaust another's budget. Fixed-window counters, two buckets:

| Bucket | Default | Applied to |
|---|---|---|
| `write` | 30/window | portfolio create/update/delete, all transaction writes |
| `providerRead` | 60/window | `/valuation` GET, `/performance` GET **and** POST |

Over budget → `TooManyRequests` → `429` with a **`Retry-After`** header (seconds). Configurable via `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_WRITE_MAX`, `RATE_LIMIT_READ_MAX`; disable entirely with `RATE_LIMIT_DISABLED=1`.

### 9. Secret handling

- **No secrets in URLs.** Finnhub auth is the `X-Finnhub-Token` header; CoinGecko uses `x-cg-demo-api-key`. Keys are read lazily from `process.env` inside provider methods, so the build never imports them at module load.
- **Log redaction.** `redactSecrets()` (`lib/market-data/redact.ts`) scrubs `token`/`apikey`/`key=` query values and the exact values of `FINNHUB_API_KEY`/`COINGECKO_API_KEY` from any error before it reaches `console.error`.
- `.env` is gitignored; `.env.example` documents the keys without real values.

## Residual / known limitations (documented honestly)

1. **Rate limiting is in-process best-effort.** The default `InMemoryRateLimiter` keeps counters in module memory. On Vercel/serverless, each cold instance has its own `Map`, so the effective limit is `configured × concurrent instances`, and counters reset on scale-down. This is a shield, **not** a hard cross-instance guarantee. The `RateLimiter` interface exists so it can be swapped for a shared store (Upstash/Redis) with **zero handler changes** — implement `RateLimiter` against Redis and swap the `limiterFor` factory. *(Cross-instance behavior is unverified — no serverless deployment exercised.)*

2. **Not all reads are rate-limited.** Only `/valuation` and `/performance` call `enforceRateLimit`. The list `GET /api/portfolios`, `GET /api/portfolios/[id]`, `/holdings`, `/allocation`, `/milestones`, and `GET .../transactions` have **no** rate-limit call — yet several of them **do** price-fetch (the list summary and `/holdings`/`/allocation`/`/milestones` all run `buildValuation`, hitting the provider layer). These paths are shielded only by the in-memory price cache (60s TTL), not by a per-user HTTP budget. Consider adding `providerRead` enforcement to the provider-hitting reads.

3. **`PATCH`/`DELETE` on a transaction operate by `id` after an ownership check.** `requireOwnedTransaction` verifies ownership first, then the mutation uses `where: { id: txId }` inside a `$transaction`. Correct given the preceding check, but the mutation itself is not re-scoped by `userId` — the guarantee rests on the ordering. Keep that ordering intact when editing these handlers.

4. **Live behavior unverified.** Clerk sign-in, Neon connection, applied migrations, and cross-instance rate limiting have not been exercised end-to-end (no credentials at documentation time). All controls above are confirmed by code reading; their runtime behavior against live services is pending provisioning.

5. **No CSRF token / same-site enforcement is implemented in this module** — it relies on Clerk's session handling. If the module is exposed beyond the intended small-trusted-user scope, review cookie `SameSite`/CSRF posture at the Clerk layer.
