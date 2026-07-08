// /api/crypto-prices — live crypto quotes with mock fallback. Auth-gated read (M6.1):
// requires a signed-in user and is per-user rate-limited (CoinGecko is a metered
// upstream). Node runtime so env + the limiter run in a Node context.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { fetchLiveCryptoPrices } from "@/lib/coingecko";
import { makeCryptoPrices } from "@/lib/mock-data";

export async function GET() {
  // Auth + rate limit FIRST, in their own try/catch, so a 401/429 is never masked by
  // the provider→mock fallback below.
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "providerRead");
  } catch (err) {
    return toErrorResponse(err);
  }

  // CoinGecko live → mock on any provider error (preserves existing source:"mock").
  try {
    const quotes = await fetchLiveCryptoPrices();
    return NextResponse.json({ quotes, source: "coingecko" });
  } catch (err) {
    console.error("[crypto-prices] falling back to mock:", err);
    return NextResponse.json({ quotes: makeCryptoPrices(), source: "mock" });
  }
}
