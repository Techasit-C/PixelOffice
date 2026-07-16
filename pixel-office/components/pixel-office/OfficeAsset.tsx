"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * A real office-asset tile/sprite, rendered crisp (nearest-neighbor, no
 * blur) inside a STABLE box — `width`/`height` set the container itself, and
 * the image uses `object-fit: contain` so it can never stretch the layout
 * or grow the grid cell around it, regardless of the source PNG's own
 * aspect ratio. Falls back to `fallback` if the browser fails to load the
 * image (a real, if rare, safety net — not the primary rendering path).
 */
export function OfficeAsset({
  src,
  alt = "",
  width,
  height,
  className = "",
  imgClassName = "",
  style,
  fallback,
  scale = 1,
  filter = "none",
}: {
  src: string;
  alt?: string;
  width: number;
  height: number;
  className?: string;
  imgClassName?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
  /** Extra display scale (bottom-anchored) — see agent-models.ts for why. */
  scale?: number;
  /** CSS `filter` — used for the reused-sprite color variants. */
  filter?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return fallback ? <>{fallback}</> : null;

  return (
    <span
      className={`inline-block overflow-hidden ${className}`}
      style={{ width, height, ...style }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- pixel art needs nearest-neighbor scaling; next/image's optimizer would blur it. */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onError={() => setFailed(true)}
        className={`h-full w-full ${imgClassName}`}
        style={{
          objectFit: "contain",
          imageRendering: "pixelated",
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: "bottom center",
          filter,
        }}
      />
    </span>
  );
}
