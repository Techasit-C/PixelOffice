// MarketDataService — the DB-backed caching + rate-limit + fallback layer.
//
// Responsibilities the raw providers deliberately do NOT have:
//   1. Short-TTL in-memory cache (rate-limit shield for the dashboard poll).
//   2. Persist every fresh live price as a PriceSnapshot (audit + fallback store).
//   3. On provider failure -> newest PriceSnapshot for the asset ("cache").
//      On no snapshot -> null price with source "mock" (caller shows partial/mock).
//
// Callers (valuation route) depend on this class through its methods; they never
// import a concrete provider. Prices keyed by asset because PriceSnapshot is keyed
// by assetId, while the underlying MarketDataProvider stays purely symbol-based.
import { Prisma } from "@prisma/client";
import type { PrismaClient, AssetType } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { RoutingProvider } from "./routing-provider";
import { FX_FALLBACK_USD_THB } from "./fx-provider";
import { redactSecrets } from "./redact";
import type {
  FxQuote,
  MarketDataProvider,
  MarketQuote,
  PriceSource,
} from "./types";

const PRICE_TTL_MS = 60_000; // matches the ~45s dashboard poll cadence
const FX_TTL_MS = 60 * 60_000; // FX moves slowly; 1h is plenty

interface AssetRef {
  id: string;
  symbol: string;
  assetType: AssetType;
}

interface CacheEntry {
  quote: MarketQuote;
  at: number;
}

// Module-scoped in-memory cache — survives across requests in a warm Node
// runtime, shielding the provider from repeated hits within the TTL window.
const memPriceCache = new Map<string, CacheEntry>();
let memFx: { quote: FxQuote; at: number } | null = null;

export class MarketDataService {
  constructor(
    private readonly provider: MarketDataProvider = new RoutingProvider(),
    private readonly db: PrismaClient = defaultPrisma,
  ) {}

  /**
   * Current price for an asset, with cache -> live -> snapshot -> mock fallback.
   * Never throws: always resolves to a MarketQuote whose `source` is honest.
   */
  async getAssetPrice(asset: AssetRef): Promise<MarketQuote> {
    const cached = memPriceCache.get(asset.id);
    if (cached && Date.now() - cached.at < PRICE_TTL_MS) {
      return cached.quote;
    }

    try {
      const quote = await this.provider.getQuote(asset.symbol, asset.assetType);
      memPriceCache.set(asset.id, { quote, at: Date.now() });
      // Persist as a snapshot (fire-and-forget; a write failure must not break reads).
      void this.persistSnapshot(asset.id, quote).catch((err) => {
        console.error(
          "[market-data] snapshot persist failed:",
          redactSecrets(err),
        );
      });
      return quote;
    } catch (err) {
      // redactSecrets: never let a provider error message carry an API token to logs.
      console.error(
        `[market-data] live fetch failed for ${asset.symbol}, falling back:`,
        redactSecrets(err),
      );
      return this.fallbackFromSnapshot(asset);
    }
  }

  /** USD->THB with in-memory cache -> live -> mandate fallback (~33). */
  async getFxUsdThb(): Promise<FxQuote> {
    if (memFx && Date.now() - memFx.at < FX_TTL_MS) return memFx.quote;
    try {
      const quote = await this.provider.getFxUsdThb();
      memFx = { quote, at: Date.now() };
      return quote;
    } catch (err) {
      console.error(
        "[market-data] FX fetch failed, using fallback ~33:",
        redactSecrets(err),
      );
      if (memFx) return { ...memFx.quote, source: "cache" };
      return {
        rate: new Prisma.Decimal(FX_FALLBACK_USD_THB),
        source: "mock",
        fetchedAt: new Date(),
      };
    }
  }

  private async fallbackFromSnapshot(asset: AssetRef): Promise<MarketQuote> {
    const snap = await this.db.priceSnapshot.findFirst({
      where: { assetId: asset.id },
      orderBy: { fetchedAt: "desc" },
    });
    if (snap) {
      return {
        price: snap.price,
        currency: snap.currency,
        source: "cache",
        fetchedAt: snap.fetchedAt,
      };
    }
    // Nothing cached ever — honest mock (price 0). Caller marks source partial/mock.
    return {
      price: new Prisma.Decimal(0),
      currency: "USD",
      source: "mock",
      fetchedAt: new Date(),
    };
  }

  private async persistSnapshot(
    assetId: string,
    quote: MarketQuote,
  ): Promise<void> {
    const source: PriceSource = quote.source;
    await this.db.priceSnapshot.create({
      data: {
        assetId,
        price: quote.price,
        currency: quote.currency,
        source,
        fetchedAt: quote.fetchedAt,
      },
    });
  }
}

// Convenience factory (env keys are read lazily inside providers, so this is safe
// to call even when no keys are configured — providers just fail into fallback).
export function createMarketDataService(): MarketDataService {
  return new MarketDataService();
}
