// /api/agents — list the real Claude Code agent definitions (project + user
// scope), grouped by team. Reads the filesystem, so it needs the Node runtime.
// Auth-gated (same pattern as /api/portfolios): the agent roster is internal.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { getAgentsCached } from "@/lib/agents/agents-cache";
import type { AgentsResponse } from "@/types/agent";

export async function GET() {
  try {
    const { userId } = await requireUser();
    // Per-user cap before serving; a 429 surfaces via toErrorResponse like any
    // other error (with Retry-After), so callers see the standard error shape.
    enforceRateLimit(userId, "agentsRead");
    // Served from an in-process TTL cache; getAgentsCached wraps loadAgents,
    // which is internally fault-isolated (missing dirs / bad files never throw),
    // so the only errors reaching here are auth (401) / rate-limit (429).
    const payload: AgentsResponse = await getAgentsCached();
    return NextResponse.json(payload);
  } catch (err) {
    return toErrorResponse(err);
  }
}
