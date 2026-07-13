"use client";

import { Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import { OfficeHotspot } from "./OfficeHotspot";
import { OfficeCharacter } from "./OfficeCharacter";
import { OFFICE_CHARACTERS } from "./office-characters";
import {
  HOTSPOT_IDS,
  HOTSPOT_META,
  OFFICE_HOTSPOTS,
  type HotspotId,
} from "./office-hotspots";

const MODEL_URL = "/models/ai-office/office_room_complete.glb";

// These clusters are the original robot-shaped "AI agent" placeholders baked
// into the room model. The character models now represent the AI agents
// instead, so the robots are hidden rather than removed — office_room_complete.glb
// itself is never modified, and the mesh data is still there if ever needed.
const HIDDEN_NODE_PREFIXES = ["robot_desk_", "floor_bot_"];

/** Loads and renders the office_room_complete.glb asset (see public/models/ai-office/). */
function OfficeModel() {
  const { scene } = useGLTF(MODEL_URL);

  useEffect(() => {
    scene.traverse((obj) => {
      if (HIDDEN_NODE_PREFIXES.some((prefix) => obj.name.startsWith(prefix))) {
        obj.visible = false;
      }
    });
  }, [scene]);

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

/** The 4 remaining zone destinations (agents are now per-character — see
 * below) as real DOM buttons — works for keyboard/screen-reader users and
 * anyone who'd rather not orbit a 3D scene to reach the same panel. */
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

/** Same 6 AI-agent workstations as the clickable characters, as real DOM
 * buttons — the keyboard-accessible equivalent of clicking a character. */
function CharacterFallbackList({
  onSelect,
}: {
  onSelect?: (id: string) => void;
}) {
  if (!onSelect) return null;
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-border/40 px-1 py-2">
      <span className="w-full text-[9px] uppercase tracking-wide text-muted-foreground/60 sm:w-auto sm:pr-1">
        AI agents:
      </span>
      {OFFICE_CHARACTERS.map((character) => (
        <button
          key={character.id}
          type="button"
          onClick={() => onSelect(character.id)}
          className="rounded-sm border border-border/60 px-2 py-1 text-[9px] text-muted-foreground hover:border-current hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {character.roleLabel}
        </button>
      ))}
    </div>
  );
}

/**
 * Self-contained R3F canvas that renders the AI office GLB model with mini
 * character models seated/standing at its workstations, plus invisible click
 * hotspots over four semantic clusters (health/trading/strategy/reports —
 * see office-hotspots.ts). Client-only (WebGL has no server-side renderer) —
 * always import this via `next/dynamic(..., { ssr: false })` from whichever
 * page embeds it, never directly from a Server Component.
 */
export function PixelOffice3DScene({
  onHotspotSelect,
  onCharacterSelect,
}: {
  /** Omit to render the scene with the zone hotspots inert. */
  onHotspotSelect?: (id: HotspotId) => void;
  /** Omit to render the characters with no click interaction. */
  onCharacterSelect?: (id: string) => void;
}) {
  return (
    <div className="relative w-full">
      <div className="relative h-[420px] w-full overflow-hidden rounded-md border border-border sm:h-[520px]">
        <Canvas camera={{ position: [6, 5, 6], fov: 45 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} />
          <Suspense fallback={null}>
            <OfficeModel />
            {OFFICE_CHARACTERS.map((character) => (
              <OfficeCharacter
                key={character.id}
                character={character}
                onSelect={onCharacterSelect ?? (() => {})}
              />
            ))}
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
      <CharacterFallbackList onSelect={onCharacterSelect} />
      <HotspotFallbackList onSelect={onHotspotSelect} />
    </div>
  );
}

useGLTF.preload(MODEL_URL);
OFFICE_CHARACTERS.forEach((character) => useGLTF.preload(character.modelPath));
