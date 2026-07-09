// /api/company-status — trading-company balance summary. Auth-gated read (M6.1):
// the roster of holdings/PnL is internal, so it requires a signed-in user and is
// per-user rate-limited. Live MEXC balances fall back to mock on any provider error.
// Node runtime: the MEXC client signs requests with crypto + reads env at request time.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { fetchMexcAccountBalances,fetchMexcSpotAccount,
  fetchMexcSpotOpenOrders, } from "@/lib/exchanges/mexc";
import { makeCompanyStatusData, nowClock } from "@/lib/mock-data";




async function getMexcHoldings(): Promise<{ btc: number; usdt: number } | null> {
  const apiKey = process.env.MEXC_API_KEY;
  const apiSecret = process.env.MEXC_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  try {
    const balances = await fetchMexcAccountBalances({ apiKey, apiSecret });
    const btc = balances.find((b) => b.asset === "BTC");
    const usdt = balances.find((b) => b.asset === "USDT");
    return {
      btc: btc ? Number(btc.free) + Number(btc.locked) : 0,
      usdt: usdt ? Number(usdt.free) + Number(usdt.locked) : 0,
    };
  } catch (err) {
    console.error("[company-status] MEXC fetch failed, using mock value:", toErrorResponse(err));
    return null;
  }
}

export async function GET() {
  try {
    const { userId } = await requireUser();
    // Provider-hitting read (MEXC) — cap per user to protect upstream quota. A 429
    // surfaces via toErrorResponse with Retry-After, like every other route.
    enforceRateLimit(userId, "providerRead");

    const mock = makeCompanyStatusData();
    const holdings = await getMexcHoldings();
const apiKey = process.env.MEXC_API_KEY;
const apiSecret = process.env.MEXC_API_SECRET;

const spotAccount =
  apiKey && apiSecret
    ? await fetchMexcSpotAccount({ apiKey, apiSecret }).catch(() => null)
    : null;

const spotOrders =
  apiKey && apiSecret
    ? await fetchMexcSpotOpenOrders({ apiKey, apiSecret }).catch(() => [])
    : [];

   const spotBalances =
  spotAccount?.balances
    ?.map((balance) => {
      const free = Number(balance.free ?? 0);
      const locked = Number(balance.locked ?? 0);
      const total = free + locked;

      return {
        asset: balance.asset,
        free: String(balance.free ?? "0"),
        locked: String(balance.locked ?? "0"),
        total: String(total),
      };
    })
    .filter((balance) => Number(balance.total) > 0) ?? [];

const spot = {
  source: spotAccount ? ("live" as const) : ("unavailable" as const),
  balances: spotBalances,
  openOrders: spotOrders.map((order) => ({
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    price: String(order.price ?? "0"),
    origQty: String(order.origQty ?? "0"),
    executedQty: String(order.executedQty ?? "0"),
    status: order.status,
  })),
};

const futures = {
  source: "unavailable" as const,
  walletBalance: "0",
  availableBalance: "0",
  unrealizedPnl: "0",
  positions: [],
};

    return NextResponse.json({
      // Realized/total PnL, net cashflow, APY and safe-withdraw aren't derivable
      // from a plain balance snapshot (they need full trade/ledger history), so
      // these stay mock even once MEXC keys are set.
      realizedPnl: mock.realizedPnl,
      totalPnl: mock.totalPnl,
      netCashflow: mock.netCashflow,
      apy: mock.apy,
      safeWithdraw: mock.safeWithdraw,
      holdingsBtc: holdings?.btc ?? mock.holdingsBtc,
      holdingsUsdt: holdings?.usdt ?? mock.holdingsUsdt,
      holdingsSource: holdings ? "live" : "mock",
      mexc: {
  source: holdings ? "live" : "unavailable",
  spot,
  futures,
},
      updatedAt: nowClock(),
    });
  } catch (err) {
    // Only auth (401) / rate-limit (429) reach here — getMexcHoldings is
    // self-contained and never throws (mock fallback on any provider error).
    return toErrorResponse(err);
  }
  
}
