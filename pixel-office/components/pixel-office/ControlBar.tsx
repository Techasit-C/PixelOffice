"use client";

import Link from "next/link";
import { useState } from "react";
import { LayoutGrid, RotateCcw } from "lucide-react";

// Additive "Views" launcher for the new full-page surfaces. Kept self-contained so
// it doesn't touch any existing ControlBar control or the office's behavior.
const VIEW_LINKS: { href: string; label: string }[] = [
  { href: "/executive", label: "Executive Dashboard" },
  { href: "/operations", label: "AI Operations Center" },
  { href: "/mission-control", label: "Mission Control" },
  { href: "/portfolio", label: "Portfolio" },
];

function ViewsLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-md border border-border/70 bg-black/60 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur hover:border-border hover:text-foreground"
      >
        <LayoutGrid className="h-3 w-3" /> Views ▾
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-1.5 flex min-w-44 flex-col gap-0.5 rounded-md border border-border/70 bg-black/90 p-1 backdrop-blur"
        >
          {VIEW_LINKS.map((v) => (
            <Link
              key={v.href}
              href={v.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="rounded-sm px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-white/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {v.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ControlBar({
  onResetLayout,
  closedWidgets,
  onReopen,
}: {
  onResetLayout: () => void;
  closedWidgets: { id: string; title: string }[];
  onReopen: (id: string) => void;
}) {
  return (
    <>
      <div className="fixed bottom-3 left-3 z-50 flex items-center gap-2">
        <ViewsLauncher />
        <button
          type="button"
          onClick={onResetLayout}
          className="flex items-center gap-1.5 rounded-md border border-border/70 bg-black/60 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur hover:border-border hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" /> รีเซ็ตเลย์เอาต์
        </button>
        {closedWidgets.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => onReopen(w.id)}
            className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[10px] text-primary hover:bg-primary/20"
          >
            + {w.title}
          </button>
        ))}
      </div>
    </>
  );
}
