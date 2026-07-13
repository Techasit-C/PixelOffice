import type { LucideIcon } from "lucide-react";

const HAIR = [
  "#2a2a2a",
  "#e07a2c",
  "#3a3a3a",
  "#221d1a",
  "#5a3a1a",
  "#6b4a2f",
  "#8a5a2a",
];
const SKIN = ["#f0c090", "#e8b98a", "#d9a066", "#f2d0b0"];

/** Stable non-negative hash of a string (djb-ish). No randomness. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * A chibi/pixel-HD AI operator: a big rounded head over a small torso, built
 * entirely from CSS shapes (no image assets, no canvas). Hair/skin are a
 * deterministic per-name hash so every character reads as an individual, on
 * top of the department-colored "uniform". Idle motion (bounce, head tilt,
 * typing hands, a periodic speech bubble) is CSS-only and paused under
 * prefers-reduced-motion (see globals.css) — none of it shifts layout.
 */
export function OperatorAvatar({
  name,
  accent,
  errored = false,
  executive = false,
  AccessoryIcon,
  catchphrase,
}: {
  name: string;
  accent: string;
  errored?: boolean;
  executive?: boolean;
  AccessoryIcon: LucideIcon;
  catchphrase: string;
}) {
  const h = hashString(name);
  const hair = HAIR[h % HAIR.length];
  const skin = SKIN[(h >> 3) % SKIN.length];
  const statusColor = errored ? "#ef4444" : "#22c55e";
  const bubbleDelay = `${((h >> 5) % 60) / 10}s`;

  return (
    <div className="relative h-[92px] w-16">
      {/* speech bubble — its own reserved slot, never shifts the figure below */}
      <div
        className="animate-bubble-pulse absolute left-1/2 top-0 z-20 w-max max-w-[100px] -translate-x-1/2 whitespace-nowrap rounded-md border border-[#00000055] bg-[#fdf6e3] px-1.5 py-0.5 text-center text-[7px] leading-tight text-[#3a2c1e] shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
        style={{ animationDelay: bubbleDelay }}
      >
        {catchphrase}
        <span className="absolute left-1/2 top-full h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-[#00000055] bg-[#fdf6e3]" />
      </div>

      {/* the figure — bounces independently of the (fixed-slot) speech bubble */}
      <div className="animate-idle-bounce absolute left-1/2 top-4 h-[76px] w-16 -translate-x-1/2">
        {/* contact shadow */}
        <div className="absolute bottom-0 left-1/2 h-2 w-9 -translate-x-1/2 rounded-full bg-black/40 blur-[2px]" />

        {/* torso */}
        <div
          className="absolute bottom-1.5 left-1/2 h-6 w-9 -translate-x-1/2 rounded-xl border border-black/25"
          style={{ background: accent }}
        >
          {executive ? (
            <span className="absolute left-1/2 top-0 h-full w-1.5 -translate-x-1/2 rounded-full bg-[#f7e9b0]/85" />
          ) : null}
          <span
            className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full"
            style={{ background: statusColor, boxShadow: `0 0 4px ${statusColor}` }}
          />
        </div>

        {/* arms — alternating typing motion */}
        <div
          className="animate-type-hand absolute bottom-3 left-1 h-3.5 w-1.5 rounded-full"
          style={{ background: skin, border: "1px solid rgba(0,0,0,0.2)" }}
        />
        <div
          className="animate-type-hand absolute bottom-3 right-1 h-3.5 w-1.5 rounded-full"
          style={{
            background: skin,
            border: "1px solid rgba(0,0,0,0.2)",
            animationDelay: "0.45s",
          }}
        />

        {/* head — chibi-dominant, gentle idle tilt */}
        <div
          className="animate-head-tilt absolute left-1/2 top-1 h-8 w-8 origin-bottom -translate-x-1/2 overflow-hidden rounded-full border border-black/20"
          style={{ background: skin }}
        >
          <span className="absolute -top-1 left-1/2 h-4 w-8 -translate-x-1/2 rounded-t-full" style={{ background: hair }} />
          <span className="absolute left-2 top-4 h-[3px] w-[3px] rounded-full bg-[#2a2a2a]" />
          <span className="absolute right-2 top-4 h-[3px] w-[3px] rounded-full bg-[#2a2a2a]" />
          <span className="absolute left-1 top-5 h-1 w-1 rounded-full opacity-40" style={{ background: accent }} />
          <span className="absolute right-1 top-5 h-1 w-1 rounded-full opacity-40" style={{ background: accent }} />
        </div>

        {/* role accessory badge */}
        <div
          className="absolute -right-1 top-0 z-10 flex h-5 w-5 items-center justify-center rounded-full border"
          style={{
            borderColor: `${accent}bb`,
            background: `${accent}33`,
            boxShadow: `0 0 5px ${accent}88`,
          }}
        >
          <AccessoryIcon className="h-3 w-3" style={{ color: accent }} strokeWidth={2.5} />
        </div>

        {executive ? (
          <span
            className="animate-hologram absolute -right-1.5 -top-1.5 z-20 h-2 w-2 rounded-full bg-[#fde68a]"
            style={{ boxShadow: "0 0 6px #eab308" }}
          />
        ) : null}
      </div>
    </div>
  );
}
