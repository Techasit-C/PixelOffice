"use client";

import { useEffect, useRef, useState } from "react";
import type { Group } from "three";
import { Html, useAnimations, useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { OfficeCharacterDef } from "./office-characters";

// office_room_complete.glb is authored Z-up (confirmed empirically: wall-
// mounted props sit at high Z, the floor slab is thin in Z). These Kenney
// character rigs are standard Y-up with feet at local Y=0. Rotating +90°
// about X turns "stands tall along Y" into "stands tall along Z", matching
// the room. This fixed correction is applied in its own inner group so a
// character's per-instance yaw (rotation.z, the room's real up-axis) stays a
// simple, unambiguous single-axis rotation in the outer group.
const AXIS_FIX_ROTATION: [number, number, number] = [Math.PI / 2, 0, 0];

/**
 * One seated/standing AI character at a workstation. Loads its own GLB
 * (each character in office-characters.ts uses a distinct file, so drei's
 * per-URL GLTF cache never has to serve the same scene to two instances),
 * plays its configured idle/sit animation on loop, and exposes the same
 * hover + click affordance as OfficeHotspot.
 */
export function OfficeCharacter({
  character,
  onSelect,
}: {
  character: OfficeCharacterDef;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<Group>(null);
  const { scene, animations } = useGLTF(character.modelPath);
  const { actions } = useAnimations(animations, ref);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const action = actions[character.animation];
    action?.reset().fadeIn(0.2).play();
    return () => {
      action?.fadeOut(0.2);
    };
  }, [actions, character.animation]);

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    onSelect(character.id);
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
    <group position={character.position} rotation={character.rotation}>
      <group rotation={AXIS_FIX_ROTATION} scale={character.scale}>
        <primitive
          ref={ref}
          object={scene}
          onClick={handleClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        />
      </group>
      {hovered ? (
        <Html position={[0, 0, 1.3]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
          <span className="whitespace-nowrap rounded-sm border border-black/40 bg-black/80 px-2 py-1 font-pixel text-[9px] text-white shadow-[0_2px_6px_rgba(0,0,0,0.5)]">
            {character.name} — {character.roleLabel}
          </span>
        </Html>
      ) : null}
    </group>
  );
}
