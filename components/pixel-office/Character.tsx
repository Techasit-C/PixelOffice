"use client";

import { useEffect, useRef, useState } from "react";
import { PixelSprite } from "./PixelSprite";
import type { CharacterDef } from "./characters-data";

const SPEED_PX_PER_SEC = 28;

export function Character({
  def,
  resetSignal,
}: {
  def: CharacterDef;
  resetSignal: number;
}) {
  const [pos, setPos] = useState(def.home);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [frame, setFrame] = useState<0 | 1>(0);
  const [walking, setWalking] = useState(false);
  const [speech, setSpeech] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function scheduleNext(delay: number) {
    const t = setTimeout(act, delay);
    timers.current.push(t);
  }

  function act() {
    const willTalk = Math.random() < 0.4;
    if (willTalk) {
      const line = def.lines[Math.floor(Math.random() * def.lines.length)];
      setSpeech(line);
      const t = setTimeout(() => {
        setSpeech(null);
        scheduleNext(1500 + Math.random() * 2500);
      }, 2600);
      timers.current.push(t);
      return;
    }

    const { minX, maxX, minY, maxY } = def.bounds;
    const targetX = minX + Math.random() * (maxX - minX);
    const targetY = minY + Math.random() * (maxY - minY);

    setPos((current) => {
      const dx = targetX - current.x;
      const dy = targetY - current.y;
      const dist = Math.hypot(dx, dy);
      const duration = Math.max(400, (dist / SPEED_PX_PER_SEC) * 1000);

      if (Math.abs(dx) > 2) setFacing(dx < 0 ? "left" : "right");
      setWalking(true);

      const t = setTimeout(() => {
        setWalking(false);
        scheduleNext(1200 + Math.random() * 2200);
      }, duration);
      timers.current.push(t);

      return { x: targetX, y: targetY };
    });
  }

  useEffect(() => {
    setPos(def.home);
    clearTimers();
    scheduleNext(600 + Math.random() * 1500);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  useEffect(() => {
    if (!walking) return;
    const id = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), 220);
    return () => clearInterval(id);
  }, [walking]);

  const displayFrame = walking ? frame : 0;
  const travelDuration = 900;

  return (
    <div
      className="absolute"
      style={{
        left: pos.x,
        top: pos.y,
        transition: `left ${travelDuration}ms linear, top ${travelDuration}ms linear`,
      }}
    >
      {speech ? (
        <div className="absolute -top-9 left-1/2 w-max max-w-[160px] -translate-x-1/2 rounded-md border border-border/70 bg-black/85 px-2 py-1 text-[10px] leading-tight text-foreground shadow-lg">
          {speech}
        </div>
      ) : null}
      <div className="flex flex-col items-center">
        <PixelSprite def={def} frame={displayFrame} facing={facing} />
        <div className="mt-0.5 rounded-sm bg-black/70 px-1 text-[9px] leading-tight text-foreground/90">
          {def.name}
        </div>
      </div>
    </div>
  );
}
