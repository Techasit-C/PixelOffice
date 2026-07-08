import type { ReactNode } from "react";

/**
 * Honest "mock / UI-only" ribbon for exchange-less / demo widgets.
 *
 * Promoted out of MissionControlClient so the office-homepage widgets can share
 * the exact same honesty marker. Appearance is unchanged; the default copy is
 * the original grid-bot ribbon text so existing call sites render identically
 * when no `children` are provided.
 */
export function MockRibbon({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-2 rounded-sm border border-warning/40 bg-warning/10 px-2 py-1 text-[9px] leading-tight text-warning">
      {children ?? "UI / mock — ไม่มี grid-bot API จาก exchange (no exchange grid-bot API)"}
    </div>
  );
}
