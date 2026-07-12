// /api/company-status — trading-company balance summary. Auth-gated read (M6.1):
// the roster of holdings/PnL is internal, so it requires a signed-in user and is
// per-user rate-limited. Live MEXC balances fall back to mock on any provider error.
// Node runtime: the MEXC client signs requests with crypto + reads env at request time.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { redactSecrets } from "@/lib/market-data/redact";
import {
  fetchMexcAccountBalances,
  fetchMexcSpotAccount,
  fetchMexcSpotOpenOrders,
  fetchMexcFuturesAccount,
  fetchMexcFuturesOpenPositions,
  fetchMexcFuturesOpenOrders,
} from "@/lib/exchanges/mexc";
import {
  shapeFutures,
  resolvePnlSource,
  composeTotalPnl,
} from "@/lib/company-status/health";
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
    // Redact before logging — a provider error may carry the signed URL/key.
    console.error(
      "[company-status] MEXC fetch failed, using mock value:",
      redactSecrets(err),
    );
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
    const apiKey = process.env.MEXC_API_KEY;
    const apiSecret = process.env.MEXC_API_SECRET;
    const hasKeys = Boolean(apiKey && apiSecret);
    const creds = { apiKey: apiKey as string, apiSecret: apiSecret as string };

    // SPOT and FUTURES fail INDEPENDENTLY. The futures helpers already swallow every
    // error (missing key / permission / signature / host) and return null, so the
    // FUTURES section degrades to "unavailable" without ever throwing here.
    const [holdings, spotAccount, spotOrders, futAssets, futPositions, futOrders] =
      await Promise.all([
        getMexcHoldings(),
        hasKeys ? fetchMexcSpotAccount(creds).catch(() => null) : Promise.resolve(null),
        hasKeys ? fetchMexcSpotOpenOrders(creds).catch(() => []) : Promise.resolve([]),
        hasKeys ? fetchMexcFuturesAccount(creds) : Promise.resolve(null),
        hasKeys ? fetchMexcFuturesOpenPositions(creds) : Promise.resolve(null),
        hasKeys ? fetchMexcFuturesOpenOrders(creds) : Promise.resolve(null),
      ]);

    const spotBalances =
      spotAccount?.balances
        ?.map((balance) => {
          const free = Number(balance.free ?? 0);
          const locked = Number(balance.locked ?? 0);
          return {
            asset: balance.asset,
            free: String(balance.free ?? "0"),
            locked: String(balance.locked ?? "0"),
            total: String(free + locked),
          };
        })
        .filter((balance) => Number(balance.total) > 0) ?? [];

    const spot = {
      source: spotAccount ? ("live" as const) : ("unavailable" as const),
      balances: spotBalances,
      openOrders: (spotOrders ?? []).map((order) => ({
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        price: String(order.price ?? "0"),
        origQty: String(order.origQty ?? "0"),
        executedQty: String(order.executedQty ?? "0"),
        status: order.status,
      })),
    };

    const futures = shapeFutures(futAssets, futPositions, futOrders);
    const futuresLive = futures.source === "live";

    // Realized PnL & Net Cashflow require a read-only trade/ledger history endpoint
    // that this CR does NOT implement, so they stay mock and are flagged not-live.
    const realizedLive = false;
    const cashflowLive = false;

    const totalPnl = composeTotalPnl({
      futuresLive,
      futuresUnrealizedPnl: futures.unrealizedPnl,
      realizedLive,
      realizedPnl: mock.realizedPnl,
      mockTotalPnl: mock.totalPnl,
    });
    const pnlSource = resolvePnlSource({ futuresLive, realizedLive, cashflowLive });

    return NextResponse.json({
      // Realized PnL & Net Cashflow need full trade/ledger history (not implemented
      // here), so they stay mock; pnlSource reports the honest provenance. Total PnL
      // becomes the live futures uPnL when futures are live, else the mock total.
      realizedPnl: mock.realizedPnl,
      totalPnl,
      netCashflow: mock.netCashflow,
      pnlSource,
      apy: mock.apy,
      safeWithdraw: mock.safeWithdraw,
      holdingsBtc: holdings?.btc ?? mock.holdingsBtc,
      holdingsUsdt: holdings?.usdt ?? mock.holdingsUsdt,
      holdingsSource: holdings ? "live" : "mock",
      mexc: {
        source:
          spot.source === "live" || futuresLive
            ? ("live" as const)
            : ("unavailable" as const),
        spot,
        futures,
      },
      updatedAt: nowClock(),
    });
  } catch (err) {
    // Only auth (401) / rate-limit (429) reach here — the MEXC helpers are
    // self-contained and never throw (mock/unavailable fallback on any error).
    return toErrorResponse(err);
  }
}
