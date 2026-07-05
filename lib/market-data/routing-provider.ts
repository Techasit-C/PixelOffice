// RoutingProvider — one MarketDataProvider that dispatches by asset type:
//   CRYPTO        -> CoinGecko
//   EQUITY / ETF  -> Finnhub
//   FX (USD/THB)  -> FxProvider
//
// This is still a "raw" provider: it throws on failure. Caching, snapshot
// fallback and mock degradation live in MarketDataService (service.ts).
import type { AssetType } from "@prisma/client";
import { CoinGeckoProvider } from "./coingecko-provider";
import { FinnhubProvider } from "./finnhub-provider";
import { FxProvider } from "./fx-provider";
import type { FxQuote, MarketDataProvider, MarketQuote } from "./types";

export class RoutingProvider implements MarketDataProvider {
  constructor(
    private readonly crypto: MarketDataProvider = new CoinGeckoProvider(),
    private readonly equity: MarketDataProvider = new FinnhubProvider(),
    private readonly fx: MarketDataProvider = new FxProvider(),
  ) {}

  getQuote(symbol: string, assetType: AssetType): Promise<MarketQuote> {
    if (assetType === "CRYPTO") return this.crypto.getQuote(symbol, assetType);
    return this.equity.getQuote(symbol, assetType);
  }

  getFxUsdThb(): Promise<FxQuote> {
    return this.fx.getFxUsdThb();
  }
}
