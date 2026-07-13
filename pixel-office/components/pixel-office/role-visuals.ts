import {
  Bot,
  BookOpen,
  Bug,
  CalendarDays,
  Coins,
  Code2,
  Container,
  Crown,
  Database,
  Gauge,
  Gavel,
  Globe,
  KanbanSquare,
  Landmark,
  Lock,
  MessageSquare,
  type LucideIcon,
  Newspaper,
  PieChart,
  Ruler,
  Search,
  Server,
  ShieldAlert,
  Sigma,
  SlidersHorizontal,
  TrendingUp,
  Zap,
  Cpu,
} from "lucide-react";

// Gives every canonical specialist a distinct monitor-screen glyph so desks
// don't look interchangeable. Unknown/custom agent names fall back to a
// neutral bot icon rather than guessing.
const ROLE_ICONS: Record<string, LucideIcon> = {
  "ai-ceo": Crown,
  "master-decision-agent": Gavel,
  "cio-agent": PieChart,
  "fundamental-analyst": Landmark,
  "technical-analyst": TrendingUp,
  "macro-economist": Globe,
  "crypto-research-analyst": Coins,
  "quant-analyst": Sigma,
  "swing-trader": Zap,
  "dca-portfolio-agent": CalendarDays,
  "risk-manager-agent": ShieldAlert,
  "news-sentiment-agent": Newspaper,
  "portfolio-optimizer": SlidersHorizontal,
  "investment-analyst": Search,
  "solution-architect": Ruler,
  "frontend-developer": Code2,
  "backend-developer": Server,
  "database-engineer": Database,
  "ai-integration-engineer": Cpu,
  "devops-engineer": Container,
  "qa-engineer": Bug,
  "performance-engineer": Gauge,
  "security-engineer": Lock,
  "prompt-engineer": MessageSquare,
  "documentation-engineer": BookOpen,
  "project-manager": KanbanSquare,
};

// Coordinator/lead roles get an extra monitor to read as senior desks.
const SENIOR_ROLES = new Set([
  "ai-ceo",
  "master-decision-agent",
  "cio-agent",
  "solution-architect",
  "project-manager",
]);

export function getRoleIcon(name: string): LucideIcon {
  return ROLE_ICONS[name.trim().toLowerCase()] ?? Bot;
}

/** Stable non-negative hash of a string. Never randomness — must match on SSR/CSR. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic 1-2 monitor count per agent, +1 for senior/coordinator roles. */
export function getMonitorCount(name: string): number {
  const key = name.trim().toLowerCase();
  const base = 1 + (hashString(key) % 2);
  return SENIOR_ROLES.has(key) ? Math.min(base + 1, 3) : base;
}

// What a desk's secondary screens animate — a small, purely decorative motion
// motif per role family (never a claim about real data).
export type DeskKind =
  | "chart"
  | "hologram"
  | "radar"
  | "code"
  | "ui"
  | "data"
  | "checklist"
  | "server"
  | "doc"
  | "board"
  | "neural"
  | "nodes";

const DESK_KIND: Record<string, DeskKind> = {
  "ai-ceo": "hologram",
  "master-decision-agent": "hologram",
  "cio-agent": "doc",
  "fundamental-analyst": "doc",
  "technical-analyst": "chart",
  "macro-economist": "chart",
  "crypto-research-analyst": "chart",
  "quant-analyst": "hologram",
  "swing-trader": "chart",
  "dca-portfolio-agent": "doc",
  "risk-manager-agent": "radar",
  "news-sentiment-agent": "doc",
  "portfolio-optimizer": "doc",
  "investment-analyst": "chart",
  "solution-architect": "board",
  "frontend-developer": "ui",
  "backend-developer": "code",
  "database-engineer": "data",
  "ai-integration-engineer": "nodes",
  "devops-engineer": "server",
  "qa-engineer": "checklist",
  "performance-engineer": "chart",
  "security-engineer": "radar",
  "prompt-engineer": "neural",
  "documentation-engineer": "doc",
  "project-manager": "board",
};

const FALLBACK_DESK_KINDS: DeskKind[] = ["chart", "code", "data", "doc"];

/** Deterministic desk-screen motif for any agent, known or custom. */
export function getDeskKind(name: string): DeskKind {
  const key = name.trim().toLowerCase();
  const known = DESK_KIND[key];
  if (known) return known;
  return FALLBACK_DESK_KINDS[hashString(key) % FALLBACK_DESK_KINDS.length];
}

// Short decorative speech-bubble lines per role — flavor only, never a claim
// about a real running task or log line.
const CATCHPHRASES: Record<string, string> = {
  "ai-ceo": "Reviewing the room…",
  "master-decision-agent": "Weighing it all up…",
  "cio-agent": "Balancing the book…",
  "fundamental-analyst": "Reading the filings…",
  "technical-analyst": "Watching the chart…",
  "macro-economist": "Tracking the macro…",
  "crypto-research-analyst": "Checking on-chain…",
  "quant-analyst": "Running the numbers…",
  "swing-trader": "Eyeing a setup…",
  "dca-portfolio-agent": "Steady as she goes…",
  "risk-manager-agent": "Scanning for risk…",
  "news-sentiment-agent": "Skimming headlines…",
  "portfolio-optimizer": "Tuning the weights…",
  "investment-analyst": "Pulling fresh data…",
  "solution-architect": "Sketching the design…",
  "frontend-developer": "Polishing the UI…",
  "backend-developer": "Wiring the API…",
  "database-engineer": "Tending the data…",
  "ai-integration-engineer": "Linking the models…",
  "devops-engineer": "Shipping it out…",
  "qa-engineer": "Ticking the checklist…",
  "performance-engineer": "Chasing milliseconds…",
  "security-engineer": "Locking things down…",
  "prompt-engineer": "Tuning the prompt…",
  "documentation-engineer": "Writing it up…",
  "project-manager": "Planning the sprint…",
};

const FALLBACK_CATCHPHRASES = [
  "On it…",
  "Heads down…",
  "Focused…",
  "Just thinking…",
];

/** Deterministic decorative speech-bubble line for any agent, known or custom. */
export function getCatchphrase(name: string): string {
  const key = name.trim().toLowerCase();
  const known = CATCHPHRASES[key];
  if (known) return known;
  return FALLBACK_CATCHPHRASES[hashString(key) % FALLBACK_CATCHPHRASES.length];
}
