import type { Metadata } from "next";
import OperationsCenterClient from "@/components/operations/OperationsCenterClient";

export const metadata: Metadata = {
  title: "Operations — Pixel Office",
  description:
    "ศูนย์ปฏิบัติการ AI: กำลังพล agent ทั้งหมด, error board, scope/source และกิจกรรมแก้ไขไฟล์ล่าสุด",
};

// Reads /api/agents client-side (Route Handler enforces auth). Server render is a
// deterministic loading gate, so SSR is safe (same pattern as /portfolio).
export default function OperationsPage() {
  return <OperationsCenterClient />;
}
