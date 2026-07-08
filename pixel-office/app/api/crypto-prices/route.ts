import { NextResponse } from "next/server";
import { fetchLiveCryptoPrices } from "@/lib/coingecko";
import { makeCryptoPrices } from "@/lib/mock-data";

export async function GET() {
  try {
    const quotes = await fetchLiveCryptoPrices();
    return NextResponse.json({ quotes, source: "coingecko" });
  } catch (err) {
    console.error("[crypto-prices] falling back to mock:", err);
    return NextResponse.json({ quotes: makeCryptoPrices(), source: "mock" });
  }
}
