export type WidgetGateReason = "auth" | "rate";

/**
 * Calm in-widget placeholder for the PUBLIC root page (`/`), shown when an
 * auth-gated read (M6.1) returns 401 to a logged-out visitor, or 429 when
 * per-user rate-limited. The root route is intentionally public and must NOT
 * force sign-in, so the affected widgets degrade quietly here instead of
 * crashing / spinning / erroring. Styling mirrors the existing muted empty
 * state (see TVSignalsWidget) so it reads as "no data yet", never as real data.
 */
export function WidgetGatedNotice({ reason }: { reason: WidgetGateReason }) {
  const text =
    reason === "auth"
      ? "เข้าสู่ระบบเพื่อดูข้อมูลนี้ (ข้อมูลภายใน)"
      : "แตะขีดจำกัดชั่วคราว — ระบบจะลองใหม่ให้อัตโนมัติ";
  return (
    <div className="flex min-h-[3rem] items-center py-2 text-[10px] leading-relaxed text-muted-foreground">
      {text}
    </div>
  );
}
