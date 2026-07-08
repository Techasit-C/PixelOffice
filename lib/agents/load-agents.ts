// Orchestrates the agents data path: read both scopes off disk, parse + classify
// each .md, derive status, dedupe (project shadows user), group by team, and sort.
//
// Fault isolation is a hard requirement — this never throws for a missing
// directory or a single malformed file. A missing dir yields readable:false /
// count:0; a bad file yields an AgentInfo with status:"error". Only frontmatter
// fields + mtime ever leave this module — never the markdown body.
import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import { displayDir, projectAgentsDir, userAgentsDir } from "./paths";
import { parseFrontmatter } from "./frontmatter";
import { classifyTeam, teamLabel } from "./teams";
import type {
  AgentInfo,
  AgentScope,
  AgentsResponse,
  AgentTeam,
  AgentTeamGroup,
} from "@/types/agent";

// Canonical group order; only non-empty groups are emitted.
const TEAM_ORDER: AgentTeam[] = ["trading", "developer", "other"];

// Error messages that frontmatter.ts intentionally throws and that are safe to
// surface to the client (they describe the file's own content, not the host).
// Everything else — Node IO errors (EACCES/EISDIR/EMFILE/…), zod internals — is
// masked to avoid leaking absolute paths or the OS username.
const SAFE_PARSER_ERRORS = new Set<string>([
  "No YAML frontmatter block found",
]);
const GENERIC_PARSE_ERROR = "Failed to parse agent file";

/** Map a caught error to a client-safe message, logging the real cause server-side. */
function toClientError(err: unknown, full: string): string {
  if (err instanceof Error && SAFE_PARSER_ERRORS.has(err.message)) {
    return err.message;
  }
  // Unexpected/IO failure: keep the real reason in server logs only.
  console.error(`[agents] failed to load agent file ${full}:`, err);
  return GENERIC_PARSE_ERROR;
}

interface ScopeResult {
  scope: AgentScope;
  dir: string;
  readable: boolean;
  count: number;
  agents: AgentInfo[];
}

/** Build the full API payload. Never rejects on FS faults. */
export async function loadAgents(): Promise<AgentsResponse> {
  // Project shadows user, so keep the scopes ordered project-first for dedupe.
  const [project, user] = await Promise.all([
    readScope("project", projectAgentsDir()),
    readScope("user", userAgentsDir()),
  ]);

  const merged = dedupe(project.agents, user.agents);
  const teams = groupByTeam(merged);
  const anyReadable = project.readable || user.readable;

  return {
    teams,
    source: anyReadable ? "filesystem" : "empty",
    generatedAt: new Date().toISOString(),
    scopes: [project, user].map(({ scope, readable, count }) => ({
      scope,
      // Masked, client-safe form — never the absolute resolved path.
      dir: displayDir(scope),
      readable,
      count,
    })),
  };
}

/** Read one scope directory. A missing/unreadable dir is not an error. */
async function readScope(scope: AgentScope, dir: string): Promise<ScopeResult> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { scope, dir, readable: false, count: 0, agents: [] };
  }

  // Regular files only: a directory named `foo.md` must not become an error row.
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => e.name);
  const agents = await Promise.all(
    mdFiles.map((filename) => loadFile(scope, dir, filename)),
  );

  return { scope, dir, readable: true, count: mdFiles.length, agents };
}

/** Load a single .md into an AgentInfo. Never throws — failures become status:"error". */
async function loadFile(
  scope: AgentScope,
  dir: string,
  filename: string,
): Promise<AgentInfo> {
  const fallbackName = filename.replace(/\.md$/i, "");
  const full = path.join(dir, filename);
  let updatedAt = new Date().toISOString();

  try {
    const [raw, stat] = await Promise.all([
      fs.readFile(full, "utf8"),
      fs.stat(full),
    ]);
    updatedAt = stat.mtime.toISOString();

    const fm = parseFrontmatter(raw, fallbackName);
    return {
      id: `${scope}:${fm.name}`,
      name: fm.name,
      role: fm.description,
      summary: firstSentence(fm.description),
      model: fm.model,
      tools: fm.tools,
      team: classifyTeam(fm.name),
      scope,
      status: "available",
      updatedAt,
    };
  } catch (err) {
    return {
      id: `${scope}:${fallbackName}`,
      name: fallbackName,
      role: "",
      summary: "",
      model: "inherit",
      tools: [],
      team: classifyTeam(fallbackName),
      scope,
      status: "error",
      updatedAt,
      error: toClientError(err, full),
    };
  }
}

/** description up to (and including) the first ". "; whole string if none. */
function firstSentence(description: string): string {
  const idx = description.indexOf(". ");
  return idx === -1 ? description : description.slice(0, idx + 1);
}

/** Merge scopes by name: project wins and is flagged overridesUser when shadowing. */
function dedupe(project: AgentInfo[], user: AgentInfo[]): AgentInfo[] {
  const userNames = new Set(user.map((a) => a.name.toLowerCase()));
  const projectNames = new Set(project.map((a) => a.name.toLowerCase()));

  const merged: AgentInfo[] = project.map((a) =>
    userNames.has(a.name.toLowerCase()) ? { ...a, overridesUser: true } : a,
  );
  for (const a of user) {
    if (!projectNames.has(a.name.toLowerCase())) merged.push(a);
  }
  return merged;
}

/** Bucket agents into ordered, non-empty team groups; sort within each group. */
function groupByTeam(agents: AgentInfo[]): AgentTeamGroup[] {
  const groups: AgentTeamGroup[] = [];
  for (const team of TEAM_ORDER) {
    const members = agents.filter((a) => a.team === team);
    if (members.length === 0) continue;
    groups.push({ team, label: teamLabel(team), agents: sortAgents(members) });
  }
  return groups;
}

/** Available agents first, then alphabetical by name. */
function sortAgents(list: AgentInfo[]): AgentInfo[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === "available" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
