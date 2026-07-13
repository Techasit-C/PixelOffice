"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Generic bottom/center overlay drawer — no domain knowledge, just chrome
 * (backdrop, title, close button, Escape-to-close). Callers own what goes
 * inside. Mirrors PixelCard's border/gradient accent styling.
 */
export function Drawer({
  open,
  title,
  accent = "#3b82f6",
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  accent?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto scrollbar-thin rounded-t-lg border shadow-[0_8px_30px_rgba(0,0,0,0.5)] sm:rounded-lg"
        style={{
          borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
          background: "linear-gradient(180deg, rgba(15,18,32,0.98), rgba(10,12,22,0.98))",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="sticky top-0 flex items-center justify-between gap-2 border-b px-4 py-3"
          style={{
            borderColor: `color-mix(in oklab, ${accent} 35%, transparent)`,
            background: "rgba(10,12,22,0.98)",
          }}
        >
          <h2 className="truncate font-pixel text-xs tracking-wide" style={{ color: accent }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-white/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
