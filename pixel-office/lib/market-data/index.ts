// Public surface of the market-data module. Business logic imports from here and
// depends on the MarketDataProvider / MarketDataService types — never on a concrete
// provider file.
export type {
  MarketDataProvider,
  MarketQuote,
  FxQuote,
  PriceSource,
  FxSource,
} from "./types";
export { UnsupportedAssetError, toDecimal } from "./types";
export { MarketDataService, createMarketDataService } from "./service";
export { RoutingProvider } from "./routing-provider";
export { CoinGeckoProvider } from "./coingecko-provider";
export { FinnhubProvider } from "./finnhub-provider";
export { FxProvider, FX_FALLBACK_USD_THB } from "./fx-provider";
