import type { Metadata } from "next";
import MissionControlClient from "@/components/mission-control/MissionControlClient";

export const metadata: Metadata = {
  title: "Mission Control — Pixel Office",
  description:
    "สัญญาณเทรดสด, สถานะบอท (mock), ชีพจรตลาดคริปโต และสุขภาพระบบแบบเรียลไทม์",
};

// Reuses read-only Trading endpoints (tradingview-webhook, crypto-prices, affiliate,
// company-status, agents) client-side. Server render is a loading gate → SSR safe.
export default function MissionControlPage() {
  return <MissionControlClient />;
}
