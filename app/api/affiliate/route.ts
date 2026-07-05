import { NextResponse } from "next/server";
import { fetchBybitEarnings } from "@/lib/exchanges/bybit";
import { fetchBitgetCommissions } from "@/lib/exchanges/bitget";
import { fetchMexcAffiliateCommission } from "@/lib/exchanges/mexc";
import { fetchUsdToThbRate } from "@/lib/fx-rate";
import { makeAffiliateData, nowClock } from "@/lib/mock-data";

const startOfDayMs = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

async function getBybitPendingUsd(): Promise<number | null> {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  try {
    const records = await fetchBybitEarnings({
      apiKey,
      apiSecret,
      startTime: startOfDayMs(),
      endTime: Date.now(),
    });
    return records.reduce((sum, r) => sum + Number(r.earning || 0), 0);
  } catch (err) {
    console.error("[affiliate] Bybit fetch failed, using mock value:", err);
    return null;
  }
}

async function getBitgetTodayUsd(): Promise<number | null> {
  const apiKey = process.env.BITGET_API_KEY;
  const apiSecret = process.env.BITGET_API_SECRET;
  const passphrase = process.env.BITGET_API_PASSPHRASE;
  if (!apiKey || !apiSecret || !passphrase) return null;

  try {
    const records = await fetchBitgetCommissions({
      apiKey,
      apiSecret,
      passphrase,
      startTime: startOfDayMs(),
      endTime: Date.now(),
    });
    return records.reduce((sum, r) => sum + Number(r.totalRebateAmount || 0), 0);
  } catch (err) {
    console.error("[affiliate] Bitget fetch failed, using mock value:", err);
    return null;
  }
}

async function getMexcTodayUsd(): Promise<number | null> {
  const apiKey = process.env.MEXC_API_KEY;
  const apiSecret = process.env.MEXC_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  try {
    const records = await fetchMexcAffiliateCommission({
      apiKey,
      apiSecret,
      startTime: startOfDayMs(),
      endTime: Date.now(),
    });
    return records.reduce((sum, r) => sum + Number(r.commissionAmount || 0), 0);
  } catch (err) {
    console.error("[affiliate] MEXC fetch failed, using mock value:", err);
    return null;
  }
}

export async function GET() {
  const mock = makeAffiliateData();
  const hasAnyExchangeKey =
    (process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET) ||
    (process.env.BITGET_API_KEY &&
      process.env.BITGET_API_SECRET &&
      process.env.BITGET_API_PASSPHRASE) ||
    (process.env.MEXC_API_KEY && process.env.MEXC_API_SECRET);

  const [bybitLive, bitgetLive, mexcLive, fxRate] = await Promise.all([
    getBybitPendingUsd(),
    getBitgetTodayUsd(),
    getMexcTodayUsd(),
    fetchUsdToThbRate().catch((err) => {
      console.error("[affiliate] FX rate fetch failed, using mock value:", err);
      return null;
    }),
  ]);

  const bybitPending = bybitLive ?? mock.bybitPending;
  const bitgetToday = bitgetLive ?? mock.bitgetToday;
  const mexcToday = mexcLive ?? mock.mexcToday;
  const todayUsd = bybitPending + bitgetToday + mexcToday;
  const rate = fxRate ?? mock.fxRate;

  return NextResponse.json({
    todayThb: todayUsd * rate,
    todayUsd,
    fxRate: rate,
    fxSource: "open.er-api.com",
    bybitPending,
    bitgetToday,
    mexcToday,
    updatedAt: nowClock(),
    source: hasAnyExchangeKey
      ? bybitLive || bitgetLive || mexcLive
        ? "live"
        : "mock"
      : "mock",
  });
}
