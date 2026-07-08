// Resolve the two Claude Code agent directories cross-platform, honoring env
// overrides. Project scope lives beside the repo (../.claude/agents); user scope
// lives in the home directory (~/.claude/agents) and may not exist.
import os from "node:os";
import path from "node:path";
import type { AgentScope } from "@/types/agent";

/** Absolute path to the project-scoped agents dir (26 canonical .md files). */
export function projectAgentsDir(): string {
  return (
    process.env.AGENTS_PROJECT_DIR ??
    path.resolve(process.cwd(), "..", ".claude", "agents")
  );
}

/** Absolute path to the user-scoped agents dir (optional; may be absent). */
export function userAgentsDir(): string {
  return (
    process.env.AGENTS_USER_DIR ??
    path.join(os.homedir(), ".claude", "agents")
  );
}

/**
 * Masked, client-safe label for a scope's directory. The real resolved paths
 * (used internally for the FS read) embed the home dir + OS username, so the
 * value that leaves the module is a stable relative/`~`-anchored form instead.
 */
export function displayDir(scope: AgentScope): string {
  return scope === "user" ? "~/.claude/agents" : ".claude/agents";
}
