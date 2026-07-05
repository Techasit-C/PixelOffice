# Provider Layer (Market Data)

Location: `lib/market-data/*`. This layer answers one question — "what is X worth right now?" — for equities, ETFs, crypto, and USD→THB FX, while shielding the rest of the app from any specific external API.

## The abstraction

Business code (the valuation engine, routes) depends **only** on the interfaces re-exported from `lib/market-data/index.ts`, never on a concrete provider file. Two layers:

```
MarketDataService   ← callers use THIS (caching + fallback; never throws)
   └── MarketDataProvider (RoutingProvider)   ← "raw" provider; throws on failure
          ├── CoinGeckoProvider   (CRYPTO)
          ├── FinnhubProvider     (EQUITY / ETF)
          └── FxProvider          (USD → THB)
```

### `MarketDataProvider` — the contract (`types.ts`)

Every raw provider implements:

```ts
interface MarketDataProvider {
  getQuote(symbol: string, assetType: AssetType): Promise<MarketQuote>; // throws on failure
  getFxUsdThb(): Promise<FxQuote>;                                      // throws on failure
}
```

- `MarketQuote = { price: Prisma.Decimal, currency: string, source: PriceSource, fetchedAt: Date }`.
- `FxQuote = { rate: Prisma.Decimal, source: FxSource, fetchedAt: Date }`.
- `PriceSource = "finnhub" | "coingecko" | "cache" | "mock"` (mirrors `PriceSnapshot.source`).
- `FxSource = "live" | "cache" | "mock"`.
- A provider that does not support an operation throws `UnsupportedAssetError` (e.g. `FinnhubProvider.getFxUsdThb()`, `CoinGeckoProvider` for non-crypto).
- **All prices are `Prisma.Decimal`, never a JS float.** External API numbers are converted via `toDecimal(n)`, which stringifies first to avoid float drift.

### `RoutingProvider` — dispatch by asset type

`RoutingProvider` is itself a `MarketDataProvider` that dispatches:

- `CRYPTO` → `CoinGeckoProvider`
- `EQUITY` / `ETF` → `FinnhubProvider`
- FX → `FxProvider`

It still throws on failure — caching and fallback are **not** its job.

### `MarketDataService` — cache + snapshot + fallback (`service.ts`)

This is what callers actually use. It **never throws**; it always resolves to a quote whose `source` is honest.

`getAssetPrice(asset)` resolution order:

1. **In-memory TTL cache** (module-scoped `Map`, keyed by `assetId`, TTL 60s). Survives across requests in a warm Node runtime — the rate-limit shield for the dashboard poll cadence.
2. **Live** via the provider. On success: cache it and **fire-and-forget persist** a `PriceSnapshot` row (a snapshot-write failure is logged but never breaks the read).
3. On provider failure: **newest `PriceSnapshot`** for the asset → `source: "cache"`.
4. On no snapshot ever: honest **mock** (`price: 0`, `source: "mock"`); the caller then reports `partial`/`mock`.

`getFxUsdThb()` mirrors this: in-memory cache (TTL 1h) → live → cached FX (`source: "cache"`) → mandate fallback `Decimal(33)` with `source: "mock"`.

> Prices are keyed by **asset id** in the service (because `PriceSnapshot` is keyed by `assetId`), while the underlying providers stay purely **symbol**-based.

## Concrete providers

| Provider | Asset types | Endpoint | Auth | Notes |
|---|---|---|---|---|
| `FinnhubProvider` | `EQUITY`, `ETF` | `GET https://finnhub.io/api/v1/quote?symbol=X` | `X-Finnhub-Token` **header** (not `?token=`) | Requires `FINNHUB_API_KEY` (throws without it). Finnhub returns `c=0` for unknown symbols instead of a 404 → treated as "no price" and thrown. |
| `CoinGeckoProvider` | `CRYPTO` | `GET .../simple/price?ids=<id>&vs_currencies=usd` | optional `x-cg-demo-api-key` header (`COINGECKO_API_KEY`) | Symbol→coin-id map is a fixed allow-list (`BTC`, `ETH`, `SOL`, …); unknown symbols throw rather than guess. |
| `FxProvider` | FX only | `open.er-api.com` via `lib/fx-rate.ts` `fetchUsdToThbRate()` | none | `FX_FALLBACK_USD_THB = "33"` (mandate rate) used only when live and cache are both gone. |

### Header auth and why it matters

Finnhub is authenticated via the **`X-Finnhub-Token` request header** rather than the `?token=` query param. Reason: a key in a URL can leak into logs, proxies, and any error message that echoes the request URL. Keeping it in a header means the key never appears in the URL in the first place.

### Secret redaction (`redact.ts`)

`MarketDataService` funnels every provider error through `redactSecrets()` before `console.error`. It:

- strips `?token=` / `apikey` / `api_key` / `key=` query values (defense-in-depth for any future URL-based path),
- and redacts the exact values of known env secrets (`FINNHUB_API_KEY`, `COINGECKO_API_KEY`) if they appear anywhere in the message (only when the value is ≥ 6 chars, to avoid redacting trivial strings).

So even if a provider error somehow carried a token, it is scrubbed before it can reach logs (which may ship to a third-party aggregator).

## Adding a new provider

The interface contract is the whole job. To add, say, an Alpha Vantage equity provider:

1. **Implement `MarketDataProvider`** in a new file `lib/market-data/alphavantage-provider.ts`:
   - `getQuote(symbol, assetType)`: guard the asset types you support (throw `UnsupportedAssetError` otherwise), fetch, and return a `MarketQuote` with `price` built via `toDecimal()`, an honest `source`, and a `fetchedAt`. **Throw** on any failure — the service turns throws into fallbacks.
   - `getFxUsdThb()`: throw `UnsupportedAssetError` if you do not do FX.
   - Read API keys from `process.env` **inside the method** (lazily), so the build never imports keys at module load and a missing key degrades to fallback.
   - Prefer header auth; never put secrets in the URL.
2. **Add a `PriceSource` value** in `types.ts` if the provenance is new, and mirror it in `PriceSnapshot.source` expectations. (If you reuse `"finnhub"`/`"coingecko"`/`"cache"`/`"mock"`, no change needed.)
3. **Wire it into `RoutingProvider`** (constructor default or the dispatch in `getQuote`), or inject it — `RoutingProvider` and `MarketDataService` both take their dependencies via constructor, so you can compose without editing them.
4. **Re-export** from `index.ts` if it is part of the public surface.
5. Callers change **nothing** — they depend on `MarketDataService` / the interface.

## Caching, rate limiting, and fallback summary

| Concern | Where | Behavior |
|---|---|---|
| Short-TTL cache | `MarketDataService` in-memory `Map` | price 60s, FX 1h; per warm Node instance |
| Durable fallback store | `PriceSnapshot` table | every fresh live price is persisted; used as fallback on provider failure |
| Graceful degradation | `MarketDataService` | live → cache → newest snapshot → mock; the read never throws |
| Honest provenance | `source` on every quote/valuation | `finnhub`/`coingecko` = live; `cache`/`mock` = degraded; aggregated to `live`/`partial`/`mock` at the portfolio level |
| Upstream quota protection (HTTP) | `enforceRateLimit(userId, "providerRead")` | on `/valuation` and `/performance` handlers — separate from the in-memory cache |

> **Unverified:** live Finnhub/CoinGecko/FX calls and `PriceSnapshot` persistence have not been exercised end-to-end at documentation time (no keys/DB). The fallback and redaction logic is confirmed by code reading.
