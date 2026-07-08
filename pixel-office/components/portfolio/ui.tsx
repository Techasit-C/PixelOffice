"use client";

import { AlertTriangle, Inbox, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type { ValuationSource } from "@/lib/portfolio-client/types";

/** Panel frame — mirrors WidgetWindow's border/gradient/clip aesthetic for the page. */
export function Panel({
  title,
  accent = "#3b82f6",
  right,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  accent?: string;
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-md border shadow-[0_8px_30px_rgba(0,0,0,0.45)]",
        className,
      )}
      style={{
        borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
        background:
          "linear-gradient(180deg, rgba(15,18,32,0.97), rgba(10,12,22,0.97))",
        clipPath:
          "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
      }}
    >
      <header
        className="flex items-center justify-between gap-2 border-b px-3 py-2"
        style={{
          borderColor: `color-mix(in oklab, ${accent} 35%, transparent)`,
          background: `color-mix(in oklab, ${accent} 12%, transparent)`,
        }}
      >
        <h2
          className="truncate font-pixel text-[10px] leading-none tracking-wide"
          style={{ color: accent }}
        >
          {title}
        </h2>
        {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
      </header>
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/** live / partial / mock marker — follows the existing widget convention. */
export function SourceBadge({ source }: { source?: ValuationSource | string }) {
  if (!source) return null;
  const live = source === "live";
  const partial = source === "partial";
  return (
    <span
      className={cn(
        "rounded-sm px-1 text-[10px] leading-4",
        live && "bg-success/15 text-success",
        partial && "bg-warning/15 text-warning",
        !live && !partial && "bg-white/5 text-muted-foreground/70",
      )}
      title={
        live
          ? "ราคาสด"
          : partial
            ? "ราคาบางส่วนสด บางส่วนสำรอง"
            : "ข้อมูลจำลอง (mock)"
      }
    >
      {source}
    </span>
  );
}

export function LoadingBlock({ label = "กำลังโหลด…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div
      className="space-y-2"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        <span>{label}</span>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-6 animate-pulse rounded bg-white/5"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

export function EmptyBlock({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground/60" aria-hidden />
      <p className="text-xs font-medium text-foreground">{title}</p>
      {hint ? <p className="max-w-xs text-[11px] text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorBlock({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 py-8 text-center"
    >
      <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
      <p className="text-xs font-medium text-danger">โหลดข้อมูลไม่สำเร็จ</p>
      <p className="max-w-xs text-[11px] text-muted-foreground">{error.message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-sm border border-border px-2 py-1 text-[11px] text-foreground hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          ลองใหม่
        </button>
      ) : null}
    </div>
  );
}

/**
 * Accessible modal: role=dialog + aria-modal, Escape to close, backdrop click to
 * close, focus moves to the panel on open and is restored to the opener on close.
 */
export function Modal({
  open,
  onClose,
  title,
  accent = "#3b82f6",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  accent?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") trapFocus(e, panelRef.current);
    };
    document.addEventListener("keydown", onKey);
    // focus first focusable, else the panel
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input,select,textarea,button,[href],[tabindex]:not([tabindex="-1"])',
    );
    (first ?? panelRef.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-md border shadow-[0_8px_40px_rgba(0,0,0,0.6)] focus:outline-none"
        style={{
          borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
          background:
            "linear-gradient(180deg, rgba(17,20,34,0.99), rgba(11,13,24,0.99))",
        }}
      >
        <header
          className="flex items-center justify-between gap-2 border-b px-4 py-3"
          style={{
            borderColor: `color-mix(in oklab, ${accent} 35%, transparent)`,
            background: `color-mix(in oklab, ${accent} 12%, transparent)`,
          }}
        >
          <h2
            id={titleId}
            className="font-pixel text-[11px] tracking-wide"
            style={{ color: accent }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="grid h-6 w-6 place-items-center rounded-sm bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function trapFocus(e: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const focusables = container.querySelectorAll<HTMLElement>(
    'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
