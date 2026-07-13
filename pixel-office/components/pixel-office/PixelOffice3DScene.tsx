"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import { OfficeHotspot } from "./OfficeHotspot";
import {
  HOTSPOT_IDS,
  HOTSPOT_META,
  OFFICE_HOTSPOTS,
  type HotspotId,
} from "./office-hotspots";

const MODEL_URL = "/models/ai-office/office_room_complete.glb";

/** Loads and renders the office_room_complete.glb asset (see public/models/ai-office/). */
function OfficeModel() {
  const { scene } = useGLTF(MODEL_URL);
  return <primitive object={scene} scale={1} />;
}

/** HTML loading overlay driven by drei's global loader-progress store. */
function LoaderOverlay() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
      <span className="rounded-sm bg-black/70 px-3 py-1.5 font-pixel text-[10px] text-foreground/90">
        กำลังโหลดโมเดล 3D… {Math.round(progress)}%
      </span>
    </div>
  );
}

/** Same 5 destinations as the 3D hotspots, as real DOM buttons — works for
 * keyboard/screen-reader users and anyone who'd rather not orbit a 3D scene
 * to get to the same panel a mouse click on the model would open. */
function HotspotFallbackList({
  onSelect,
}: {
  onSelect?: (id: HotspotId) => void;
}) {
  if (!onSelect) return null;
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-border/40 px-1 py-2">
      <span className="w-full text-[9px] uppercase tracking-wide text-muted-foreground/60 sm:w-auto sm:pr-1">
        Jump to:
      </span>
      {HOTSPOT_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className="rounded-sm border border-border/60 px-2 py-1 text-[9px] text-muted-foreground hover:border-current hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {HOTSPOT_META[id].title}
        </button>
      ))}
    </div>
  );
}

/**
 * Self-contained R3F canvas that renders the AI office GLB model, plus
 * invisible click hotspots over five semantic clusters (agents/health/
 * trading/strategy/reports — see office-hotspots.ts). Client-only (WebGL has
 * no server-side renderer) — always import this via
 * `next/dynamic(..., { ssr: false })` from whichever page embeds it, never
 * directly from a Server Component.
 */
export function PixelOffice3DScene({
  onHotspotSelect,
}: {
  /** Omit to render the scene with no interaction (hotspots become inert). */
  onHotspotSelect?: (id: HotspotId) => void;
}) {
  return (
    <div className="relative w-full">
      <div className="relative h-[420px] w-full overflow-hidden rounded-md border border-border sm:h-[520px]">
        <Canvas camera={{ position: [6, 5, 6], fov: 45 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} />
          <Suspense fallback={null}>
            <OfficeModel />
            {onHotspotSelect
              ? OFFICE_HOTSPOTS.map((hotspot) => (
                  <OfficeHotspot key={hotspot.key} hotspot={hotspot} onSelect={onHotspotSelect} />
                ))
              : null}
          </Suspense>
          <OrbitControls enablePan={false} minDistance={3} maxDistance={16} />
        </Canvas>
        <LoaderOverlay />
      </div>
      <HotspotFallbackList onSelect={onHotspotSelect} />
    </div>
  );
}

useGLTF.preload(MODEL_URL);
