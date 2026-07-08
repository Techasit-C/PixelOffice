import type { Metadata } from "next";
import PortfolioPageClient from "@/components/portfolio/PortfolioPageClient";

export const metadata: Metadata = {
  title: "Portfolio — Pixel Office",
  description: "จัดการพอร์ตการลงทุน มูลค่า การจัดสรร และความคืบหน้า DCA สู่ ฿1,000,000",
};

// The management surface fetches per-user data client-side (Route Handlers enforce
// auth). The initial server render is a deterministic loading gate, so SSR is safe
// here (unlike the office page, which needs NoSSR for drag/localStorage/DOM inject).
export default function PortfolioPage() {
  return <PortfolioPageClient />;
}
