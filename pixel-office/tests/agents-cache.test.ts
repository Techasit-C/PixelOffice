// Sprint 5: TTL cache in front of loadAgents(). Drives getAgentsCached against a
// throwaway fixture tree (AGENTS_PROJECT_DIR / AGENTS_USER_DIR) so results are
// deterministic, and uses __resetAgentsCache + fake Date to control expiry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getAgentsCached, __resetAgentsCache } from "@/lib/agents/agents-cache";

describe("getAgentsCached (TTL cache over loadAgents)", () => {
  let root: string;
  let projectDir: string;
  let userDir: string;
  const prevProject = process.env.AGENTS_PROJECT_DIR;
  const prevUser = process.env.AGENTS_USER_DIR;
  const prevTtl = process.env.AGENTS_CACHE_TTL_MS;

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

  function names(res: Awaited<ReturnType<typeof getAgentsCached>>): string[] {
    return res.teams.flatMap((t) => t.agents).map((a) => a.name).sort();
  }

  beforeEach(async () => {
    __resetAgentsCache();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agents-cache-test-"));
    projectDir = path.join(root, "project");
    userDir = path.join(root, "user");
    await fs.mkdir(projectDir);
    await fs.mkdir(userDir);
    process.env.AGENTS_PROJECT_DIR = projectDir;
    process.env.AGENTS_USER_DIR = userDir;
  });

  afterEach(async () => {
    vi.useRealTimers();
    __resetAgentsCache();
    if (prevProject === undefined) delete process.env.AGENTS_PROJECT_DIR;
    else process.env.AGENTS_PROJECT_DIR = prevProject;
    if (prevUser === undefined) delete process.env.AGENTS_USER_DIR;
    else process.env.AGENTS_USER_DIR = prevUser;
    if (prevTtl === undefined) delete process.env.AGENTS_CACHE_TTL_MS;
    else process.env.AGENTS_CACHE_TTL_MS = prevTtl;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns the SAME cached object within the TTL window", async () => {
    process.env.AGENTS_CACHE_TTL_MS = "30000";
    await fs.writeFile(path.join(projectDir, "quant-analyst.md"), agentFile("quant-analyst"));

    const first = await getAgentsCached();
    // Mutate the FS after the first read — it must NOT be reflected while cached.
    await fs.writeFile(path.join(projectDir, "cio-agent.md"), agentFile("cio-agent"));
    const second = await getAgentsCached();

    expect(second).toBe(first); // same reference: no rebuild, no re-read
    expect(names(second)).toEqual(["quant-analyst"]);
  });

  it("rebuilds via loadAgents once the TTL expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-07T00:00:00Z"));
    process.env.AGENTS_CACHE_TTL_MS = "1000";
    await fs.writeFile(path.join(projectDir, "quant-analyst.md"), agentFile("quant-analyst"));

    const first = await getAgentsCached();
    expect(names(first)).toEqual(["quant-analyst"]);

    // Change the FS, then advance the clock just past the TTL.
    await fs.writeFile(path.join(projectDir, "cio-agent.md"), agentFile("cio-agent"));
    vi.setSystemTime(Date.now() + 1001);

    const second = await getAgentsCached();
    expect(second).not.toBe(first); // rebuilt: fresh object
    expect(names(second)).toEqual(["cio-agent", "quant-analyst"]);
  });

  it("keeps serving the cached object right up to the TTL boundary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-07T00:00:00Z"));
    process.env.AGENTS_CACHE_TTL_MS = "1000";
    await fs.writeFile(path.join(projectDir, "quant-analyst.md"), agentFile("quant-analyst"));

    const first = await getAgentsCached();
    vi.setSystemTime(Date.now() + 999); // still inside the window
    const second = await getAgentsCached();
    expect(second).toBe(first);
  });

  it("falls back to the default TTL when AGENTS_CACHE_TTL_MS is invalid", async () => {
    process.env.AGENTS_CACHE_TTL_MS = "not-a-number";
    await fs.writeFile(path.join(projectDir, "quant-analyst.md"), agentFile("quant-analyst"));

    const first = await getAgentsCached();
    const second = await getAgentsCached();
    expect(second).toBe(first); // default 30s keeps it cached
  });
});
