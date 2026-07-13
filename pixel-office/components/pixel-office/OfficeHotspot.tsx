"use client";

import { useState } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { HotspotId, OfficeHotspotDef } from "./office-hotspots";

// Real geometry is tight around each prop; padding makes the invisible
// hitbox a bit more forgiving to click without spilling into neighbors.
const PAD = 1.25;

/**
 * One invisible bounding-box click target over a semantic cluster of the
 * office model (e.g. every mesh belonging to the server rack). Decoupled
 * from the visual geometry on purpose — the underlying GLB has ~130 flat
 * sibling nodes with no per-prop parent group, so a single padded proxy box
 * is far simpler and more forgiving than wiring up every child mesh.
 */
export function OfficeHotspot({
  hotspot,
  onSelect,
}: {
  hotspot: OfficeHotspotDef;
  onSelect: (id: HotspotId) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const size: [number, number, number] = [
    hotspot.size[0] * PAD,
    hotspot.size[1] * PAD,
    hotspot.size[2] * PAD,
  ];

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    onSelect(hotspot.id);
  }

  function handlePointerOver(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    setHovered(true);
    document.body.style.cursor = "pointer";
  }

  function handlePointerOut(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    setHovered(false);
    document.body.style.cursor = "auto";
  }

  return (
    <mesh
      position={hotspot.center}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <boxGeometry args={size} />
      <meshBasicMaterial
        color={hovered ? "#fde68a" : "#ffffff"}
        transparent
        opacity={hovered ? 0.16 : 0}
        depthWrite={false}
      />
      {hovered ? (
        <Html center distanceFactor={8} style={{ pointerEvents: "none" }}>
          <span className="whitespace-nowrap rounded-sm border border-black/40 bg-black/80 px-2 py-1 font-pixel text-[9px] text-white shadow-[0_2px_6px_rgba(0,0,0,0.5)]">
            {hotspot.label}
          </span>
        </Html>
      ) : null}
    </mesh>
  );
}
