import type { Quote } from "@/types/market";

export interface AffiliateData {
  todayThb: number;
  todayUsd: number;
  fxRate: number;
  fxSource: string;
  bybitPending: number;
  bitgetToday: number;
  mexcToday: number;
  updatedAt: string;
  source?: "live" | "mock";
}

export interface CompanyStatusData {
  realizedPnl: number;
  totalPnl: number;
  netCashflow: number;
  holdingsBtc: number;
  holdingsUsdt: number;
  apy: number;
  safeWithdraw: number;
  updatedAt: string;
  holdingsSource?: "live" | "mock";
   mexc?: MexcCompanyStatus;
  
}

export interface GridBotData {
  roiPercent: number;
  totalProfit: number;
  gridProfit: number;
  rangeLow: number;
  rangeHigh: number;
  status: "RUNNING" | "PAUSED" | "STOPPED";
  source: string;
  updatedAt: string;
}

export interface TradingData {
  pnlToday: number;
  realized: number;
  floating: number;
  wins: number;
  losses: number;
  openPositions: number;
  version: string;
  magicNumber: string;
  updatedAt: string;
}

export interface ChatEntry {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export function makeAffiliateData(): AffiliateData {
  return {
    todayThb: 983.43,
    todayUsd: 30.16,
    fxRate: 32.61,
    fxSource: "open.er-api.com",
    bybitPending: 13.57,
    bitgetToday: 16.59,
    mexcToday: 0,
    updatedAt: "11:16",
  };
}

export function makeCompanyStatusData(): CompanyStatusData {
  return {
    realizedPnl: -1757,
    totalPnl: -1035,
    netCashflow: 27463,
    holdingsBtc: 0,
    holdingsUsdt: 26454,
    apy: 1.1,
    safeWithdraw: 0,
    updatedAt: "11:16",
  };
}

export function makeGridBotData(): GridBotData {
  return {
    roiPercent: -1763.44,
    totalProfit: -305.35,
    gridProfit: 4.07,
    rangeLow: 0.0025,
    rangeHigh: 0.0045,
    status: "RUNNING",
    source: "mock (ui-only)",
    updatedAt: "11:14",
  };
}

export function makeTradingData(): TradingData {
  return {
    pnlToday: 41.03,
    realized: 41.03,
    floating: 0,
    wins: 2,
    losses: 0,
    openPositions: 0,
    version: "v2",
    magicNumber: "22222",
    updatedAt: "11:16",
  };
}

export function makeCryptoPrices(): Quote[] {
  const base: Array<[string, string, number, number, number]> = [
    ["BTC", "Bitcoin", 73042, -3.4, 1.46e12],
    ["ETH", "Ethereum", 1977, -4.4, 238.5e9],
    ["USDT", "Tether", 0.9984, 0, 189.3e9],
    ["BNB", "BNB", 635.59, -2.7, 85.6e9],
    ["XRP", "XRP", 1.28, -3.5, 79.2e9],
    ["USDC", "USD Coin", 1.0, 0, 76.4e9],
    ["SOL", "Solana", 80.53, -3.6, 46.6e9],
    ["TRX", "TRON", 0.3663, -2.0, 34.7e9],
    ["FIGR_", "Figure", 1.03, 0.6, 18.7e9],
    ["DOGE", "Dogecoin", 0.0979, -3.2, 15.1e9],
    ["LINEA", "Linea", 0.002919, -4.8, 88e6],
  ];
  return base.map(([symbol, name, price, changePercent, marketCap]) => ({
    symbol,
    name,
    price,
    changePercent,
    marketCap,
  }));
}

export function makeChatSeed(): ChatEntry[] {
  return [];
}

/** Small random walk so widgets feel alive without a real backend. */
export function jitter(value: number, pct = 0.004) {
  const delta = value * pct * (Math.random() * 2 - 1);
  return value + delta;
}

export function nowClock() {
  return new Date().toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
export interface MexcSpotBalance {
  asset: string;
  free: string;
  locked: string;
  total: string;
}

export interface MexcFuturesPosition {
  symbol: string;
  side: string;
  size: string;
  entryPrice?: string;
  markPrice?: string;
  unrealizedPnl?: string;
}

export interface MexcCompanyStatus {
  source: "live" | "pending" | "unavailable";
  spot: {
    source: "live" | "pending" | "unavailable";
    balances: MexcSpotBalance[];
    openOrders: MexcSpotOrder[];
  };
  futures: {
    source: "live" | "pending" | "unavailable";
    walletBalance: string;
    availableBalance: string;
    unrealizedPnl: string;
    positions: MexcFuturesPosition[];
  };
}
export interface MexcSpotOrder {
  symbol: string;
  side: string;
  type: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
}