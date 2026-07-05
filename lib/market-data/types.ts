// Market Data Provider abstraction — contracts only.
//
// Business logic (valuation, routes) depends ONLY on these interfaces, never on a
// concrete provider (Finnhub/CoinGecko/FX). This is the seam that lets us swap or
// add providers, add caching, and fall back to cached PriceSnapshots without any
// caller change.
import { Prisma } from "@prisma/client";
import type { AssetType } from "@prisma/client";

// Where a price ultimately came from. Mirrors PriceSnapshot.source in the schema.
export type PriceSource = "finnhub" | "coingecko" | "cache" | "mock";

export interface MarketQuote {
  /** Per-unit price in `currency`. Decimal — never a JS float in downstream math. */
  price: Prisma.Decimal;
  /** Native currency of `price` (e.g. "USD"). */
  currency: string;
  /** Honest provenance of this number. */
  source: PriceSource;
  /** When this price was produced/observed. */
  fetchedAt: Date;
}

export type FxSource = "live" | "cache" | "mock";

export interface FxQuote {
  /** USD -> THB rate. */
  rate: Prisma.Decimal;
  source: FxSource;
  fetchedAt: Date;
}

/**
 * The single interface all market-data consumers depend on.
 *
 * Concrete providers (FinnhubProvider, CoinGeckoProvider, FxProvider) each throw
 * on failure; the caching/fallback service (MarketDataService) is what turns those
 * failures into cached/mock results so the UI never sees a throw.
 */
export interface MarketDataProvider {
  /** Live per-unit quote for a symbol of the given asset type. Throws on failure. */
  getQuote(symbol: string, assetType: AssetType): Promise<MarketQuote>;
  /** Live USD->THB rate. Throws on failure. */
  getFxUsdThb(): Promise<FxQuote>;
}

/** A provider may only support some asset types. */
export class UnsupportedAssetError extends Error {
  constructor(assetType: AssetType, provider: string) {
    super(`${provider} does not support asset type ${assetType}`);
    this.name = "UnsupportedAssetError";
  }
}

/** Convert an external API number to a Decimal via its string form (no float drift). */
export function toDecimal(n: number | string): Prisma.Decimal {
  return new Prisma.Decimal(typeof n === "number" ? n.toString() : n);
}
