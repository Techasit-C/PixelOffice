"use client";

import { Headphones, Pause, Play, Zap } from "lucide-react";
import { useEffect, useState } from "react";

const TRACK = { title: "Pixel Rain", durationSec: 3 * 60 + 30 };

export function LofiWidget() {
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(65);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setElapsed((e) => (e + 1 >= TRACK.durationSec ? 0 : e + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [playing]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const totalMins = Math.floor(TRACK.durationSec / 60);
  const totalSecs = TRACK.durationSec % 60;
  const progress = (elapsed / TRACK.durationSec) * 100;

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-primary/20 text-primary hover:bg-primary/30"
        >
          <Headphones className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-muted-foreground">Now Playing</div>
          <div className="truncate text-sm font-semibold text-primary">
            {TRACK.title}
          </div>
          <div className="text-[10px] tabular-nums text-muted-foreground">
            {mins}:{secs.toString().padStart(2, "0")} / {totalMins}:
            {totalSecs.toString().padStart(2, "0")}
          </div>
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>คุยกันเอง: {playing ? "เปิด" : "ปิด"}</span>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="flex items-center gap-1 rounded-sm border border-border/60 px-1.5 py-0.5 hover:border-border"
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          <Zap className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
