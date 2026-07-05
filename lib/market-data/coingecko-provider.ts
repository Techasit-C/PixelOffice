// CoinGecko provider — CRYPTO quotes only.
//
// Reuses the symbol->coin-id map style of the existing lib/coingecko.ts but is
// generalized to look up an arbitrary symbol (the existing helper only fetches a
// fixed dashboard basket). Free "Demo" key is optional (x-cg-demo-api-key).
import type { AssetType } from "@prisma/client";
import {
  UnsupportedAssetError,
  toDecimal,
  type FxQuote,
  type MarketDataProvider,
  type MarketQuote,
} from "./types";

// Symbols we can resolve on CoinGecko's free simple/price endpoint. Only ids we
// are confident resolve are listed — unknown symbols throw rather than guess.
const COIN_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  BNB: "binancecoin",
  XRP: "ripple",
  USDC: "usd-coin",
  SOL: "solana",
  TRX: "tron",
  DOGE: "dogecoin",
  LINEA: "linea",
  ADA: "cardano",
  MATIC: "matic-network",
  DOT: "polkadot",
  AVAX: "avalanche-2",
  LINK: "chainlink",
};

interface SimplePriceEntry {
  usd?: number;
}

export class CoinGeckoProvider implements MarketDataProvider {
  readonly name = "CoinGeckoProvider";

  async getQuote(symbol: string, assetType: AssetType): Promise<MarketQuote> {
    if (assetType !== "CRYPTO") {
      throw new UnsupportedAssetError(assetType, this.name);
    }
    const id = COIN_IDS[symbol.toUpperCase()];
    if (!id) {
      throw new Error(`CoinGecko: unknown crypto symbol "${symbol}"`);
    }

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
    const headers: Record<string, string> = { accept: "application/json" };
    if (process.env.COINGECKO_API_KEY) {
      headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
    }

    const res = await fetch(url, { headers, next: { revalidate: 0 } });
    if (!res.ok) {
      throw new Error(`CoinGecko request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as Record<string, SimplePriceEntry>;
    const usd = data[id]?.usd;
    if (usd === undefined) {
      throw new Error(`CoinGecko: no USD price for "${symbol}"`);
    }

    return {
      price: toDecimal(usd),
      currency: "USD",
      source: "coingecko",
      fetchedAt: new Date(),
    };
  }

  getFxUsdThb(): Promise<FxQuote> {
    throw new UnsupportedAssetError("CRYPTO" as AssetType, `${this.name} (no FX)`);
  }
}
