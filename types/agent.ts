export type AgentStatus = "active" | "analyzing" | "idle" | "offline";

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  latestAnalysis: string;
  accentColor: string;
}
