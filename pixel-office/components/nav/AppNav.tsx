"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeaderAuth } from "@/components/auth/HeaderAuth";

// Shared top nav for the "AI Company Operating System" surfaces. The legacy office
// page ("/") keeps its own on-canvas ControlBar and does NOT render this nav.
const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Office" },
  { href: "/executive", label: "Executive" },
  { href: "/operations", label: "Operations" },
  { href: "/mission-control", label: "Mission Control" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/trading-bot", label: "Trading Bot" },
];

export function AppNav({ accent = "#3b82f6" }: { accent?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav
      className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur"
      aria-label="แอปพลิเคชัน"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2">
          <span
            className="font-pixel text-[11px] tracking-wide"
            style={{ color: accent }}
          >
            AI COMPANY OS
          </span>
        </div>

        {/* Desktop / tablet links */}
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-sm px-2.5 py-1.5 text-[11px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                isActive(l.href)
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
              aria-current={isActive(l.href) ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
          <span className="ml-1">
            <HeaderAuth />
          </span>
        </div>

        {/* Mobile toggle */}
        <div className="flex items-center gap-2 md:hidden">
          <HeaderAuth />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "ปิดเมนู" : "เปิดเมนู"}
            className="grid h-8 w-8 place-items-center rounded-sm border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile stacked menu */}
      {open ? (
        <div className="border-t border-border/60 px-4 py-2 md:hidden">
          <div className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-sm px-2.5 py-2 text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isActive(l.href)
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
                aria-current={isActive(l.href) ? "page" : undefined}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
