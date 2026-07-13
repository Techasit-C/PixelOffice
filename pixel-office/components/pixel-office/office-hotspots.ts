// Clickable-zone config for office_room_complete.glb. Coordinates are the
// real per-cluster bounding boxes read out of the GLB's node/accessor data
// (see the model's node names: robot_desk_*, server_rack_*, etc.) — every
// node in this model is a flat scene root with no parent transform, so a
// mesh's accessor min/max IS its world-space AABB. This file is the single
// source of truth for "what's clickable and what it means"; it never
// touches the GLB itself.
export type HotspotId = "agents" | "systemHealth" | "trading" | "strategy" | "reports";

export interface OfficeHotspotDef {
  /** Shared across every physical instance that maps to the same panel. */
  id: HotspotId;
  /** Unique per physical hotspot (a destination can have more than one prop). */
  key: string;
  label: string;
  /** World-space center, in the model's own units. */
  center: [number, number, number];
  /** World-space size (pre-padding — OfficeHotspot pads this for an easier click). */
  size: [number, number, number];
}

export const OFFICE_HOTSPOTS: OfficeHotspotDef[] = [
  {
    id: "agents",
    key: "robot-desk",
    label: "AI Agent Status",
    center: [-1.75, 0.98, 2.02],
    size: [0.8, 0.45, 1.06],
  },
  {
    id: "agents",
    key: "floor-bot",
    label: "AI Agent Status",
    center: [1.0, -2.27, 0.67],
    size: [0.8, 0.45, 1.06],
  },
  {
    id: "systemHealth",
    key: "server-rack",
    label: "System Health",
    center: [1.8, 1.18, 1.15],
    size: [1.05, 0.69, 2.3],
  },
  {
    id: "trading",
    key: "monitor-main",
    label: "Trading Dashboard",
    center: [-0.9, -1.0, 1.78],
    size: [1.05, 0.3, 0.96],
  },
  {
    id: "trading",
    key: "monitor-alpha-beta",
    label: "Trading Dashboard",
    center: [-2.65, 1.0, 1.78],
    size: [1.85, 0.3, 0.96],
  },
  {
    id: "trading",
    key: "risk-monitor",
    label: "Trading Dashboard",
    center: [2.0, -1.5, 1.78],
    size: [1.05, 0.3, 0.96],
  },
  {
    id: "strategy",
    key: "strategy-board",
    label: "Strategy & Tasks",
    center: [-2.7, 2.99, 1.9],
    size: [1.95, 0.12, 1.23],
  },
  {
    id: "strategy",
    key: "risk-board",
    label: "Strategy & Tasks",
    center: [2.3, 2.99, 1.9],
    size: [1.95, 0.12, 1.23],
  },
  {
    id: "reports",
    key: "printer",
    label: "Reports & Docs",
    center: [3.25, -2.38, 0.54],
    size: [1.0, 1.15, 0.73],
  },
  {
    id: "reports",
    key: "shelf-files",
    label: "Reports & Docs",
    center: [3.6, 1.5, 1.07],
    size: [1.3, 0.55, 2.15],
  },
];

export const HOTSPOT_META: Record<HotspotId, { title: string; accent: string }> = {
  agents: { title: "AI Agent Status", accent: "#a78bfa" },
  systemHealth: { title: "System Health", accent: "#22c55e" },
  trading: { title: "Trading Dashboard", accent: "#2962ff" },
  strategy: { title: "Strategy & Tasks", accent: "#eab308" },
  reports: { title: "Reports & Docs", accent: "#f97316" },
};

/** Unique logical destinations, in a stable order — drives the keyboard-accessible button list. */
export const HOTSPOT_IDS: HotspotId[] = ["agents", "systemHealth", "trading", "strategy", "reports"];
