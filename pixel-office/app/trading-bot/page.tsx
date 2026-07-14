import type { Metadata } from "next";
import TradingBotPageClient from "@/components/trading-bot/TradingBotPageClient";

export const metadata: Metadata = {
  title: "Trading Bot — Pixel Office",
  description: "Paper trading only. Simulated signals, mock broker, no real money.",
};

export default function TradingBotPage() {
  return <TradingBotPageClient />;
}
