import type { ReactNode } from "react";
import { AppNav } from "@/components/nav/AppNav";

/**
 * Scroll-owning shell for the new full-page views. The root <body> is
 * `overflow-hidden h-full` (see app/layout.tsx), so every routed page MUST own its
 * own scroll container — hence `h-full overflow-y-auto` on <main>.
 */
export function PageShell({
  accent = "#3b82f6",
  children,
}: {
  accent?: string;
  children: ReactNode;
}) {
  return (
    <main className="h-full overflow-y-auto bg-background scrollbar-thin">
      <AppNav accent={accent} />
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        {children}
        <p className="pt-2 text-center text-[10px] text-muted-foreground/70">
          ข้อมูลประกอบการตัดสินใจเท่านั้น ไม่ใช่คำแนะนำการลงทุน · ผู้ใช้ตัดสินใจเอง
        </p>
      </div>
    </main>
  );
}
