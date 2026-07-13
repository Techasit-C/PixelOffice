// Shared visual identity per department (cozy isometric office redesign). One
// color per department, used consistently for zone plaques, desk accents,
// and character shirts so each corner of the room reads as a distinct team
// at a glance.
export type Department =
  | "executive"
  | "trading"
  | "developer"
  | "operations"
  | "infrastructure";

export interface DepartmentTheme {
  label: string;
  color: string;
  colorSoft: string;
}

export const DEPARTMENT_THEME: Record<Department, DepartmentTheme> = {
  executive: { label: "Executive", color: "#eab308", colorSoft: "#fde68a" },
  trading: { label: "Trading", color: "#22c55e", colorSoft: "#86efac" },
  developer: { label: "Developer", color: "#3b82f6", colorSoft: "#93c5fd" },
  operations: { label: "Operations", color: "#a855f7", colorSoft: "#d8b4fe" },
  infrastructure: { label: "Infrastructure", color: "#f97316", colorSoft: "#fdba74" },
};

/** Warm parchment/wood-panel background for a zone card, tinted by department. */
export function coziBackground(color: string): string {
  return `linear-gradient(180deg, ${color}22, rgba(42,31,22,0.94) 46%)`;
}

/** The ambient outer glow + inner wash every zone card shares. */
export function glowShadow(color: string): string {
  return `0 4px 18px rgba(0,0,0,0.45), 0 0 20px ${color}22, inset 0 0 32px ${color}0f`;
}
