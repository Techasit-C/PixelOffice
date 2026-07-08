export type AgentTeam = "trading" | "developer" | "other";
export type AgentScope = "project" | "user";
export type AgentStatus = "available" | "error";

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  summary: string;
  model: string;
  tools: string[];
  team: AgentTeam;
  scope: AgentScope;
  status: AgentStatus;
  updatedAt: string;
  error?: string;
  overridesUser?: boolean;
}

export interface AgentTeamGroup {
  team: AgentTeam;
  label: string;
  agents: AgentInfo[];
}

export interface AgentsResponse {
  teams: AgentTeamGroup[];
  source: "filesystem" | "empty";
  generatedAt: string;
  scopes: Array<{
    scope: AgentScope;
    dir: string;
    readable: boolean;
    count: number;
  }>;
}
