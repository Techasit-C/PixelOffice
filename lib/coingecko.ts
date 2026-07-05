import type { Quote } from "@/types/market";

/**
 * symbol -> CoinGecko coin id. Only ids we've verified actually resolve on
 * CoinGecko are listed; unverifiable/placeholder tickers from the mock set
 * (e.g. "FIGR_") are intentionally left out rather than guessed.
 */
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
};

const NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  USDT: "Tether",
  BNB: "BNB",
  XRP: "XRP",
  USDC: "USD Coin",
  SOL: "Solana",
  TRX: "TRON",
  DOGE: "Dogecoin",
  LINEA: "Linea",
};

interface CoinGeckoSimplePriceEntry {
  usd: number;
  usd_24h_change?: number;
  usd_market_cap?: number;
}

export async function fetchLiveCryptoPrices(): Promise<Quote[]> {
  const ids = Object.values(COIN_IDS).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;

  const headers: Record<string, string> = { accept: "application/json" };
  // Optional: CoinGecko's free "Demo" plan key, if the caller has one.
  // https://docs.coingecko.com/reference/simple-price
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
  }

  const res = await fetch(url, { headers, next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(`CoinGecko request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as Record<string, CoinGeckoSimplePriceEntry>;

  return Object.entries(COIN_IDS).map(([symbol, id]) => {
    const entry = data[id];
    return {
      symbol,
      name: NAMES[symbol],
      price: entry?.usd ?? 0,
      changePercent: entry?.usd_24h_change ?? 0,
      marketCap: entry?.usd_market_cap ?? 0,
    };
  });
}
