"use client";

import { useEffect, useState } from "react";

const ZONES: { label: string; tz: string }[] = [
  { label: "NY", tz: "America/New_York" },
  { label: "LDN", tz: "Europe/London" },
  { label: "BKK", tz: "Asia/Bangkok" },
  { label: "TYO", tz: "Asia/Tokyo" },
];

function readClocks(): string[] {
  return ZONES.map((z) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: z.tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
}

/**
 * Client-only wall clocks for the lobby strip. Isolated in its own component
 * so its 30s tick re-renders only this small row, never the office scene or
 * the (potentially 100+) agent desks around it. Purely presentational — real
 * wall-clock time, not a claim about market sessions.
 */
export function WorldClocks() {
  // Null until mount: this whole scene only ever renders client-side (see
  // PixelOfficePageClient's NoSSR wrapper), but starting from a placeholder
  // keeps this component safe even if that ever changes.
  const [times, setTimes] = useState<string[] | null>(null);

  useEffect(() => {
    setTimes(readClocks());
    const id = setInterval(() => setTimes(readClocks()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2.5">
      {ZONES.map((z, i) => (
        <div key={z.label} className="flex items-center gap-1 whitespace-nowrap">
          <span className="text-[8px] uppercase tracking-wide text-muted-foreground/60">
            {z.label}
          </span>
          <span className="font-mono text-[10px] text-[#7dd3fc]">
            {times ? times[i] : "--:--"}
          </span>
        </div>
      ))}
    </div>
  );
}
