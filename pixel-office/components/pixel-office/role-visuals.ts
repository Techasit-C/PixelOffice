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
