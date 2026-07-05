"use client";

import { RotateCcw, Users } from "lucide-react";

export function ControlBar({
  onResetLayout,
  onArrangeCharacters,
  closedWidgets,
  onReopen,
}: {
  onResetLayout: () => void;
  onArrangeCharacters: () => void;
  closedWidgets: { id: string; title: string }[];
  onReopen: (id: string) => void;
}) {
  return (
    <>
      <div className="fixed bottom-3 left-3 z-50 flex items-center gap-2">
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
      <div className="fixed bottom-3 right-3 z-50">
        <button
          type="button"
          onClick={onArrangeCharacters}
          className="flex items-center gap-1.5 rounded-md border border-border/70 bg-black/60 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur hover:border-border hover:text-foreground"
        >
          <Users className="h-3 w-3" /> จัดวางตัวละคร
        </button>
      </div>
    </>
  );
}
