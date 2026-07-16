"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * A real office-asset tile/sprite, rendered crisp (nearest-neighbor, no
 * blur) at whatever size the caller asks for. Falls back to `fallback` if
 * the browser fails to load the image — keeps "every asset has a fallback"
 * true even for a bad path, not just the agents we know are missing/broken.
 */
export function OfficeAsset({
  src,
  alt = "",
  width,
  height,
  className = "",
  style,
  fallback,
}: {
  src: string;
  alt?: string;
  width: number;
  height: number;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return fallback ? <>{fallback}</> : null;

  return (
    // Pixel art needs nearest-neighbor scaling; next/image's optimizer would blur it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      draggable={false}
      onError={() => setFailed(true)}
      className={className}
      style={{ imageRendering: "pixelated", ...style }}
    />
  );
}
