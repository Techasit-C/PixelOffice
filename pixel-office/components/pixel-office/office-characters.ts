// Character roster for the interactive 3D office. Each entry places one
// Kenney mini-character model at a workstation inside office_room_complete.glb
// and (optionally) links it to a real agent record from /api/agents so its
// drawer panel can show honest, sourced status instead of invented data.
//
// Positions are in the room's own units, reusing the same landmark
// coordinates read out of the GLB in office-hotspots.ts (desk/chair/server
// rack/shelf/printer clusters). `rotation` is a room-space Euler in radians —
// in practice only the Z component (yaw, the room's up-axis) is ever
// non-zero; see OfficeCharacter.tsx for why. `scale` is uniform.
export interface OfficeCharacterDef {
  id: string;
  /** Workstation label shown in tooltips/fallback buttons. */
  name: string;
  /** Human-readable role, e.g. "CEO / Executive". */
  roleLabel: string;
  /** Real agent name to look up in /api/agents for this character's drawer, if any. */
  agentName?: string;
  modelPath: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  animation: "sit" | "idle";
}

export const OFFICE_CHARACTERS: OfficeCharacterDef[] = [
  {
    id: "executive",
    name: "Executive Desk",
    roleLabel: "CEO / Executive",
    agentName: "ai-ceo",
    modelPath: "/models/characters/agent-executive.glb",
    position: [-1.75, 1.35, 0],
    rotation: [0, 0, Math.PI],
    scale: 1.8,
    animation: "idle",
  },
  {
    id: "trading",
    name: "Trading Desk",
    roleLabel: "Trading Agent",
    agentName: "technical-analyst",
    modelPath: "/models/characters/agent-trader.glb",
    position: [-0.9, -1.55, 0],
    rotation: [0, 0, 0],
    scale: 1.8,
    animation: "sit",
  },
  {
    id: "research",
    name: "Research Corner",
    roleLabel: "Research Agent",
    agentName: "investment-analyst",
    modelPath: "/models/characters/agent-researcher.glb",
    position: [3.05, 1.5, 0],
    rotation: [0, 0, -Math.PI / 2],
    scale: 1.8,
    animation: "idle",
  },
  {
    id: "risk",
    name: "Risk Desk",
    roleLabel: "Risk Agent",
    agentName: "risk-manager-agent",
    modelPath: "/models/characters/agent-risk.glb",
    position: [2.0, -2.05, 0],
    rotation: [0, 0, Math.PI],
    scale: 1.8,
    animation: "sit",
  },
  {
    id: "devops",
    name: "Server Room",
    roleLabel: "DevOps / System Agent",
    agentName: "devops-engineer",
    modelPath: "/models/characters/agent-devops.glb",
    position: [1.35, 1.18, 0],
    rotation: [0, 0, Math.PI / 2],
    scale: 1.8,
    animation: "idle",
  },
  {
    id: "qa",
    name: "QA Station",
    roleLabel: "QA / Review Agent",
    agentName: "qa-engineer",
    modelPath: "/models/characters/agent-qa.glb",
    position: [2.65, -2.38, 0],
    rotation: [0, 0, -Math.PI / 2],
    scale: 1.8,
    animation: "idle",
  },
];
