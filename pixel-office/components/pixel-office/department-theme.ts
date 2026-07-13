// Shared visual identity per department (Bloomberg-floor redesign). One color
// per department, used consistently for panel borders/glow, headers, and desk
// accents so each floor reads as a distinct zone at a glance.
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

/** The glass-panel gradient every floor panel shares, tinted by its department. */
export function glassBackground(color: string): string {
  return `linear-gradient(180deg, ${color}14, rgba(6,9,15,0.92) 42%)`;
}

/** The ambient outer glow + inner wash every floor panel shares. */
export function glowShadow(color: string): string {
  return `0 0 24px ${color}22, inset 0 0 40px ${color}0d`;
}
