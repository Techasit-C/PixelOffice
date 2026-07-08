// Classify an agent by name into its team. Canonical lists come from the root
// CLAUDE.md org chart. Anything not on either list (including `ai-ceo`, which is
// the coordinator persona, not a team specialist) is "other".
import type { AgentTeam } from "@/types/agent";

const TRADING_AGENTS = new Set<string>([
  "master-decision-agent",
  "cio-agent",
  "fundamental-analyst",
  "technical-analyst",
  "macro-economist",
  "crypto-research-analyst",
  "quant-analyst",
  "swing-trader",
  "dca-portfolio-agent",
  "risk-manager-agent",
  "news-sentiment-agent",
  "portfolio-optimizer",
  "investment-analyst",
]);

const DEVELOPER_AGENTS = new Set<string>([
  "solution-architect",
  "frontend-developer",
  "backend-developer",
  "database-engineer",
  "ai-integration-engineer",
  "devops-engineer",
  "qa-engineer",
  "performance-engineer",
  "security-engineer",
  "prompt-engineer",
  "documentation-engineer",
  "project-manager",
]);

const TEAM_LABELS: Record<AgentTeam, string> = {
  trading: "Trading Team",
  developer: "Developer Team",
  other: "Other",
};

/** Map an agent name to its team (case-insensitive on the canonical name). */
export function classifyTeam(name: string): AgentTeam {
  const key = name.trim().toLowerCase();
  if (TRADING_AGENTS.has(key)) return "trading";
  if (DEVELOPER_AGENTS.has(key)) return "developer";
  return "other";
}

/** Human-readable label for a team. */
export function teamLabel(team: AgentTeam): string {
  return TEAM_LABELS[team];
}
