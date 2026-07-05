"use client";

import { motion } from "framer-motion";
import { Minus, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { WindowLayout } from "@/lib/use-window-manager";

interface WidgetWindowProps {
  id: string;
  title: string;
  subtitle?: string;
  width: number;
  layout: WindowLayout;
  zIndex: number;
  accent?: string;
  onMove: (id: string, x: number, y: number) => void;
  onMinimize: (id: string) => void;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  children: ReactNode;
}

export function WidgetWindow({
  id,
  title,
  subtitle,
  width,
  layout,
  zIndex,
  accent = "#3b82f6",
  onMove,
  onMinimize,
  onClose,
  onFocus,
  children,
}: WidgetWindowProps) {
  const dragOrigin = useRef({ x: layout.x, y: layout.y });

  if (layout.closed) return null;

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0}
      onDragStart={() => {
        dragOrigin.current = { x: layout.x, y: layout.y };
        onFocus(id);
      }}
      onDragEnd={(_, info) => {
        onMove(
          id,
          dragOrigin.current.x + info.offset.x,
          dragOrigin.current.y + info.offset.y,
        );
      }}
      onPointerDown={() => onFocus(id)}
      initial={false}
      animate={{ x: layout.x, y: layout.y }}
      transition={{ type: "tween", duration: 0 }}
      style={{ width, zIndex, position: "absolute", top: 0, left: 0 }}
      className="select-none"
    >
      <div
        className="overflow-hidden rounded-md border shadow-[0_8px_30px_rgba(0,0,0,0.55)]"
        style={{
          borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
          background:
            "linear-gradient(180deg, rgba(15,18,32,0.97), rgba(10,12,22,0.97))",
          clipPath:
            "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
        }}
      >
        <div
          className="flex cursor-grab items-center justify-between gap-2 border-b px-3 py-2 active:cursor-grabbing"
          style={{
            borderColor: `color-mix(in oklab, ${accent} 35%, transparent)`,
            background: `color-mix(in oklab, ${accent} 12%, transparent)`,
          }}
        >
          <div className="min-w-0">
            <div
              className="truncate font-pixel text-[10px] leading-none tracking-wide"
              style={{ color: accent }}
            >
              {title}
            </div>
            {subtitle ? (
              <div className="mt-1 truncate text-[10px] text-muted-foreground">
                {subtitle}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onMinimize(id)}
              className="grid h-5 w-5 place-items-center rounded-sm bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              aria-label="minimize"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onClose(id)}
              className="grid h-5 w-5 place-items-center rounded-sm bg-white/5 text-muted-foreground hover:bg-destructive/80 hover:text-white"
              aria-label="close"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
        {!layout.minimized ? <div className="p-3">{children}</div> : null}
      </div>
    </motion.div>
  );
}
