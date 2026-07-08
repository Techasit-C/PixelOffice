import type { CharacterDef } from "./characters-data";

interface PixelSpriteProps {
  def: CharacterDef;
  frame: 0 | 1;
  facing: "left" | "right";
}

/** Crisp-edged SVG "pixel" sprite built from flat rects — no external art assets. */
export function PixelSprite({ def, frame, facing }: PixelSpriteProps) {
  const legOffset = frame === 1 ? 1 : 0;
  const bob = frame === 1 ? 0 : -1;

  return (
    <svg
      viewBox="0 0 16 22"
      width={40}
      height={55}
      shapeRendering="crispEdges"
      style={{
        transform: `scaleX(${facing === "left" ? -1 : 1}) translateY(${bob}px)`,
        filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.5))",
      }}
    >
      {def.kind === "robot" ? (
        <>
          <rect x={7} y={0} width={2} height={2} fill={def.shirtColor} />
          <rect x={4} y={2} width={8} height={7} fill={def.hairColor} />
          <rect x={5} y={4} width={2} height={2} fill="#0ea5e9" />
          <rect x={9} y={4} width={2} height={2} fill="#0ea5e9" />
          <rect x={3} y={9} width={10} height={7} fill={def.shirtColor} />
          <rect x={2} y={10} width={2} height={4} fill={def.shirtColor} />
          <rect x={12} y={10} width={2} height={4} fill={def.shirtColor} />
          <rect
            x={4 + legOffset}
            y={16}
            width={3}
            height={5}
            fill={def.pantsColor}
          />
          <rect
            x={9 - legOffset}
            y={16}
            width={3}
            height={5}
            fill={def.pantsColor}
          />
        </>
      ) : (
        <>
          <rect x={4} y={1} width={8} height={3} fill={def.hairColor} />
          <rect x={4} y={3} width={8} height={6} fill={def.skinColor} />
          <rect x={5} y={5} width={1} height={1} fill="#1a1a1a" />
          <rect x={10} y={5} width={1} height={1} fill="#1a1a1a" />
          <rect x={3} y={9} width={10} height={7} fill={def.shirtColor} />
          <rect x={2} y={10} width={2} height={5} fill={def.shirtColor} />
          <rect x={12} y={10} width={2} height={5} fill={def.skinColor} />
          <rect
            x={4 + legOffset}
            y={16}
            width={3}
            height={5}
            fill={def.pantsColor}
          />
          <rect
            x={9 - legOffset}
            y={16}
            width={3}
            height={5}
            fill={def.pantsColor}
          />
        </>
      )}
    </svg>
  );
}
