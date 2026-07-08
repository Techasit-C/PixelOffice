// In-process TTL cache in front of loadAgents() (Sprint 5).
//
// The agents payload is a pure function of the on-disk .md files, so serving a
// slightly stale copy (≤ TTL) is acceptable and intended — it spares the FS a
// full re-read + parse on every /api/agents hit. Expiry is TIME-BASED only:
// there is no manual invalidation and we deliberately do NOT mtime-key the cache
// (in-place content edits don't bump the directory mtime, so an mtime key would
// silently miss edits — a plain TTL is both simpler and strictly safer here).
//
// ⚠️ SERVERLESS CAVEAT (mirrors rate-limit.ts): the cache lives in module memory,
// so each cold serverless instance keeps its own copy. That's fine — worst case is
// each instance independently rebuilds once per TTL window.
import { loadAgents } from "./load-agents";
import type { AgentsResponse } from "@/types/agent";

const DEFAULT_TTL_MS = 30_000; // 30s

/** Parse AGENTS_CACHE_TTL_MS, falling back to the default on missing/NaN/≤0. */
function ttlMs(): number {
  const raw = process.env.AGENTS_CACHE_TTL_MS;
  if (!raw) return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TTL_MS;
}

interface CacheEntry {
  payload: AgentsResponse;
  expiresAt: number; // epoch ms
}

let entry: CacheEntry | null = null;

/**
 * Return the agents payload, served from an in-process cache while fresh.
 * Rebuilds via loadAgents() (which never throws) once the entry has expired,
 * then caches the new payload for the next TTL window.
 */
export async function getAgentsCached(): Promise<AgentsResponse> {
  const now = Date.now();
  if (entry && now < entry.expiresAt) {
    return entry.payload;
  }

  const payload = await loadAgents();
  entry = { payload, expiresAt: now + ttlMs() };
  return payload;
}

/** Test seam: drop the cached entry between cases (mirrors __resetRateLimiters). */
export function __resetAgentsCache(): void {
  entry = null;
}
