import type { LucideIcon } from "lucide-react";

/**
 * A modern, non-pixel AI operator: rounded geometric torso + visor head,
 * built entirely from CSS shapes (no image assets, no canvas). Idle motion
 * (float, head tilt, typing hands, visor scan, status pulse) is CSS-only and
 * paused automatically under prefers-reduced-motion (see globals.css).
 *
 * `hologram` renders the CEO's translucent, flickering command presence with
 * a slow-spinning projector ring instead of the standard solid operator.
 */
export function OperatorAvatar({
  accent,
  errored = false,
  hologram = false,
  AccessoryIcon,
}: {
  accent: string;
  errored?: boolean;
  hologram?: boolean;
  AccessoryIcon: LucideIcon;
}) {
  const statusColor = errored ? "#ef4444" : accent;

  return (
    <div
      className={`relative h-16 w-14 ${hologram ? "animate-hologram" : "animate-float"}`}
    >
      {/* floor contact glow */}
      <div
        className="absolute bottom-0 left-1/2 h-2 w-10 -translate-x-1/2 rounded-full"
        style={{ background: `radial-gradient(ellipse, ${accent}66, transparent 75%)` }}
      />

      {hologram ? (
        <div
          className="animate-spin-slow absolute bottom-0.5 left-1/2 h-3 w-10 -translate-x-1/2 rounded-full border border-dashed"
          style={{ borderColor: `${accent}99` }}
        />
      ) : null}

      {/* torso */}
      <div
        className="absolute bottom-1 left-1/2 h-7 w-8 -translate-x-1/2 rounded-2xl border"
        style={{
          borderColor: `${statusColor}aa`,
          background: hologram
            ? `linear-gradient(180deg, ${accent}44, ${accent}11)`
            : "linear-gradient(180deg, #1c2534, #0c1119)",
          boxShadow: `0 0 10px ${accent}44 inset`,
        }}
      >
        {/* chest core — doubles as the status pulse */}
        <span
          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full"
          style={{ background: statusColor, boxShadow: `0 0 5px ${statusColor}` }}
        />
      </div>

      {/* arms — alternating typing motion, hung at shoulder height on the torso */}
      <div
        className="animate-type-hand absolute bottom-2 left-[7px] h-4 w-1.5 rounded-full"
        style={{ background: "#1f2937", border: `1px solid ${statusColor}88` }}
      />
      <div
        className="animate-type-hand absolute bottom-2 right-[7px] h-4 w-1.5 rounded-full"
        style={{
          background: "#1f2937",
          border: `1px solid ${statusColor}88`,
          animationDelay: "0.45s",
        }}
      />

      {/* head / visor — slow tilt, scanning eye-line */}
      <div
        className="animate-head-tilt absolute left-1/2 top-0 h-5 w-6 origin-bottom -translate-x-1/2 overflow-hidden rounded-xl border"
        style={{ borderColor: `${statusColor}aa`, background: "#0b1220" }}
      >
        <div
          className="absolute inset-x-[3px] top-1/2 h-[3px] -translate-y-1/2 rounded-full"
          style={{ background: statusColor, opacity: 0.5 }}
        />
        <div
          className="animate-visor-scan absolute top-1/2 h-[3px] w-2 -translate-y-1/2 rounded-full bg-white/70"
        />
      </div>

      {/* role accessory chip */}
      <div
        className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border"
        style={{
          borderColor: `${accent}99`,
          background: `${accent}26`,
          boxShadow: `0 0 6px ${accent}88`,
        }}
      >
        <AccessoryIcon className="h-3 w-3" style={{ color: accent }} strokeWidth={2.5} />
      </div>
    </div>
  );
}
