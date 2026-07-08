import type { Metadata } from "next";
import ExecutiveDashboardClient from "@/components/executive/ExecutiveDashboardClient";

export const metadata: Metadata = {
  title: "Executive — Pixel Office",
  description:
    "ภาพรวมผู้บริหาร: มูลค่าพอร์ต, PnL, รายได้ affiliate, สินทรัพย์คริปโต และกำลังพล AI",
};

// KPIs are composed CLIENT-SIDE from existing endpoints (each Route Handler enforces
// auth). Server render is a deterministic loading gate, so SSR is safe here (same as
// /portfolio; unlike the office page which needs NoSSR for drag/localStorage).
export default function ExecutivePage() {
  return <ExecutiveDashboardClient />;
}
