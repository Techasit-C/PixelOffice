// Finnhub provider — US stock/ETF quotes (EQUITY / ETF).
//
// Endpoint contract (https://finnhub.io/docs/api/quote): GET /api/v1/quote?symbol=X
// returns { c: current price, h, l, o, pc: previous close, t }. `c === 0` means the
// symbol did not resolve (Finnhub returns zeros rather than a 404). Requires
// FINNHUB_API_KEY; without it we cannot fetch and throw (the service then falls
// back to a cached snapshot / mock).
import type { AssetType } from "@prisma/client";
import {
  UnsupportedAssetError,
  toDecimal,
  type FxQuote,
  type MarketDataProvider,
  type MarketQuote,
} from "./types";

interface FinnhubQuoteResponse {
  c?: number; // current price
  t?: number; // unix seconds
}

export class FinnhubProvider implements MarketDataProvider {
  readonly name = "FinnhubProvider";

  async getQuote(symbol: string, assetType: AssetType): Promise<MarketQuote> {
    if (assetType !== "EQUITY" && assetType !== "ETF") {
      throw new UnsupportedAssetError(assetType, this.name);
    }
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
      throw new Error("Finnhub: FINNHUB_API_KEY not set");
    }

    // Auth via the X-Finnhub-Token request header (documented alternative to the
    // ?token= query param, https://finnhub.io/docs/api/authentication) so the key
    // never appears in the URL — where it could leak into logs, proxies, or error
    // messages that echo the request URL.
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
      symbol.toUpperCase(),
    )}`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "X-Finnhub-Token": apiKey },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      throw new Error(`Finnhub request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as FinnhubQuoteResponse;
    // Finnhub returns c=0 for unknown symbols instead of an error status.
    if (!data.c || data.c <= 0) {
      throw new Error(`Finnhub: no price for symbol "${symbol}"`);
    }

    return {
      price: toDecimal(data.c),
      currency: "USD",
      source: "finnhub",
      fetchedAt: data.t ? new Date(data.t * 1000) : new Date(),
    };
  }

  getFxUsdThb(): Promise<FxQuote> {
    throw new UnsupportedAssetError("EQUITY" as AssetType, `${this.name} (no FX)`);
  }
}
