// Unit + integration coverage for the real-agents data layer:
//   frontmatter parser, team classifier, loadAgents grouping/dedupe.
// Loader tests drive loadAgents against a throwaway fixture tree via the
// AGENTS_PROJECT_DIR / AGENTS_USER_DIR env overrides so results are deterministic.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter } from "@/lib/agents/frontmatter";
import { classifyTeam, teamLabel } from "@/lib/agents/teams";
import { loadAgents } from "@/lib/agents/load-agents";

describe("parseFrontmatter", () => {
  it("splits description on the FIRST colon only (colons in value preserved)", () => {
    const raw = [
      "---",
      "name: risk-manager-agent",
      "description: Use this: exposure, drawdown: and sizing",
      "tools: Read, Grep",
      "model: inherit",
      "---",
      "body",
    ].join("\n");
    const fm = parseFrontmatter(raw, "fallback");
    expect(fm.name).toBe("risk-manager-agent");
    expect(fm.description).toBe("Use this: exposure, drawdown: and sizing");
  });

  it("falls back to provided name when name is missing", () => {
    const raw = ["---", "description: no name here", "---"].join("\n");
    expect(parseFrontmatter(raw, "my-file-stem").name).toBe("my-file-stem");
  });

  it("falls back when name key present but empty", () => {
    const raw = ["---", "name:   ", "description: x", "---"].join("\n");
    expect(parseFrontmatter(raw, "stem").name).toBe("stem");
  });

  it("defaults missing tools to an empty array", () => {
    const raw = ["---", "name: a", "description: d", "model: inherit", "---"].join("\n");
    expect(parseFrontmatter(raw, "stem").tools).toEqual([]);
  });

  it("parses and trims a comma-separated tools list", () => {
    const raw = ["---", "name: a", "tools: WebSearch,  WebFetch , Read", "---"].join("\n");
    expect(parseFrontmatter(raw, "stem").tools).toEqual(["WebSearch", "WebFetch", "Read"]);
  });

  it("defaults missing model to inherit", () => {
    const raw = ["---", "name: a", "description: d", "---"].join("\n");
    expect(parseFrontmatter(raw, "stem").model).toBe("inherit");
  });

  it("defaults missing description to empty string", () => {
    const raw = ["---", "name: a", "---"].join("\n");
    expect(parseFrontmatter(raw, "stem").description).toBe("");
  });

  it("is insensitive to field order", () => {
    const raw = [
      "---",
      "model: sonnet",
      "tools: Bash",
      "description: ordered oddly",
      "name: odd-order",
      "---",
    ].join("\n");
    expect(parseFrontmatter(raw, "stem")).toMatchObject({
      name: "odd-order",
      model: "sonnet",
      description: "ordered oddly",
      tools: ["Bash"],
    });
  });

  it("strips a single pair of surrounding quotes from a scalar value", () => {
    const raw = ["---", "name: \"quoted-name\"", "description: d", "---"].join("\n");
    expect(parseFrontmatter(raw, "stem").name).toBe("quoted-name");
  });

  it("throws when there is no frontmatter block", () => {
    expect(() => parseFrontmatter("just a body, no fence", "stem")).toThrow();
  });

  it("throws when the frontmatter fence is never closed", () => {
    expect(() => parseFrontmatter("---\nname: a\nno closing fence", "stem")).toThrow();
  });
});

describe("classifyTeam", () => {
  it("classifies known trading agents", () => {
    for (const n of ["risk-manager-agent", "cio-agent", "quant-analyst", "investment-analyst"]) {
      expect(classifyTeam(n)).toBe("trading");
    }
  });

  it("classifies known developer agents", () => {
    for (const n of ["frontend-developer", "backend-developer", "qa-engineer", "project-manager"]) {
      expect(classifyTeam(n)).toBe("developer");
    }
  });

  it("is case-insensitive and trims the canonical name", () => {
    expect(classifyTeam("  Frontend-Developer  ")).toBe("developer");
  });

  it("classifies unknown names and the ai-ceo coordinator as other", () => {
    expect(classifyTeam("ai-ceo")).toBe("other");
    expect(classifyTeam("totally-made-up")).toBe("other");
  });

  it("exposes human labels for each team", () => {
    expect(teamLabel("trading")).toBe("Trading Team");
    expect(teamLabel("developer")).toBe("Developer Team");
    expect(teamLabel("other")).toBe("Other");
  });
});

describe("loadAgents (fixture-driven grouping + dedupe)", () => {
  let root: string;
  let projectDir: string;
  let userDir: string;
  const prevProject = process.env.AGENTS_PROJECT_DIR;
  const prevUser = process.env.AGENTS_USER_DIR;

  function agentFile(name: string): string {
    return [
      "---",
      "name: " + name,
      "description: First sentence. Second sentence.",
      "tools: Read, Grep",
      "model: inherit",
      "---",
      "body",
      "",
    ].join("\n");
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agents-test-"));
    projectDir = path.join(root, "project");
    userDir = path.join(root, "user");
    await fs.mkdir(projectDir);
    await fs.mkdir(userDir);
    process.env.AGENTS_PROJECT_DIR = projectDir;
    process.env.AGENTS_USER_DIR = userDir;
  });

  afterEach(async () => {
    if (prevProject === undefined) delete process.env.AGENTS_PROJECT_DIR;
    else process.env.AGENTS_PROJECT_DIR = prevProject;
    if (prevUser === undefined) delete process.env.AGENTS_USER_DIR;
    else process.env.AGENTS_USER_DIR = prevUser;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("groups by team in canonical order, only non-empty groups", async () => {
    await fs.writeFile(path.join(projectDir, "quant-analyst.md"), agentFile("quant-analyst"));
    await fs.writeFile(path.join(projectDir, "frontend-developer.md"), agentFile("frontend-developer"));
    await fs.writeFile(path.join(projectDir, "ai-ceo.md"), agentFile("ai-ceo"));

    const res = await loadAgents();
    expect(res.source).toBe("filesystem");
    expect(res.teams.map((t) => t.team)).toEqual(["trading", "developer", "other"]);
    expect(res.teams.find((t) => t.team === "other")?.agents.map((a) => a.name)).toEqual(["ai-ceo"]);
  });

  it("derives summary (first sentence) and every required field", async () => {
    await fs.writeFile(path.join(projectDir, "quant-analyst.md"), agentFile("quant-analyst"));
    const res = await loadAgents();
    const a = res.teams.flatMap((t) => t.agents).find((x) => x.name === "quant-analyst")!;
    expect(a).toMatchObject({
      id: "project:quant-analyst",
      name: "quant-analyst",
      role: "First sentence. Second sentence.",
      summary: "First sentence.",
      model: "inherit",
      tools: ["Read", "Grep"],
      team: "trading",
      scope: "project",
      status: "available",
    });
    expect(Number.isNaN(Date.parse(a.updatedAt))).toBe(false);
  });

  it("dedupes by name, project shadows user, sets overridesUser", async () => {
    await fs.writeFile(path.join(projectDir, "cio-agent.md"), agentFile("cio-agent"));
    await fs.writeFile(path.join(userDir, "cio-agent.md"), agentFile("cio-agent"));
    await fs.writeFile(path.join(userDir, "swing-trader.md"), agentFile("swing-trader"));

    const res = await loadAgents();
    const all = res.teams.flatMap((t) => t.agents);
    const cio = all.filter((a) => a.name === "cio-agent");
    expect(cio).toHaveLength(1);
    expect(cio[0].scope).toBe("project");
    expect(cio[0].overridesUser).toBe(true);

    const swing = all.find((a) => a.name === "swing-trader")!;
    expect(swing.scope).toBe("user");
    expect(swing.overridesUser).toBeUndefined();

    expect(res.scopes).toEqual([
      expect.objectContaining({ scope: "project", readable: true, count: 1 }),
      expect.objectContaining({ scope: "user", readable: true, count: 2 }),
    ]);
  });

  it("reports source empty and does not throw when neither dir is readable", async () => {
    process.env.AGENTS_PROJECT_DIR = path.join(root, "does-not-exist-a");
    process.env.AGENTS_USER_DIR = path.join(root, "does-not-exist-b");
    const res = await loadAgents();
    expect(res.source).toBe("empty");
    expect(res.teams).toEqual([]);
    expect(res.scopes.every((s) => s.readable === false)).toBe(true);
  });

  it("isolates a malformed file as a per-file error, not a crash", async () => {
    await fs.writeFile(path.join(projectDir, "quant-analyst.md"), agentFile("quant-analyst"));
    await fs.writeFile(path.join(projectDir, "broken.md"), "no frontmatter here at all");
    const res = await loadAgents();
    const all = res.teams.flatMap((t) => t.agents);
    const broken = all.find((a) => a.name === "broken")!;
    expect(broken.status).toBe("error");
    expect(broken.error).toBeTruthy();
    expect(all.find((a) => a.name === "quant-analyst")!.status).toBe("available");
  });

  it("sorts available agents before errored ones, then alphabetically", async () => {
    await fs.writeFile(path.join(projectDir, "cio-agent.md"), agentFile("cio-agent"));
    await fs.writeFile(path.join(projectDir, "quant-analyst.md"), agentFile("quant-analyst"));
    await fs.writeFile(path.join(projectDir, "risk-manager-agent.md"), "garbage-no-frontmatter");
    const res = await loadAgents();
    const trading = res.teams.find((t) => t.team === "trading")!;
    expect(trading.agents.map((a) => a.name)).toEqual([
      "cio-agent",
      "quant-analyst",
      "risk-manager-agent",
    ]);
    expect(trading.agents.at(-1)!.status).toBe("error");
  });
});
