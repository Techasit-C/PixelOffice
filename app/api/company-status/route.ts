import { NextResponse } from "next/server";
import { fetchMexcAccountBalances } from "@/lib/exchanges/mexc";
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
    console.error("[company-status] MEXC fetch failed, using mock value:", err);
    return null;
  }
}

export async function GET() {
  const mock = makeCompanyStatusData();
  const holdings = await getMexcHoldings();

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
    updatedAt: nowClock(),
  });
}
