// Daily snapshot cron — auth + batch orchestration, factored OUT of the route so the
// fail-closed auth check and the pure aggregation are unit-testable WITHOUT a live DB,
// market-data providers, or the Next.js request pipeline.
//
// [CRON SEAM] realized: snapshot-service.ts documents a once-daily job that values
// EVERY portfolio after US market close. This module is that job's core logic; the
// route (app/api/cron/snapshot/route.ts) is a thin adapter that loads all portfolios,
// brands each via asSystemOwnedPortfolio(), and hands them to runSnapshotBatch().
import { redactSecrets } from "@/lib/market-data/redact";
import { constantTimeEqual } from "@/lib/api/verify-secret";

/**
 * Result of capturing ONE portfolio.
 *   "captured" — a snapshot row was upserted for today.
 *   "skipped"  — nothing to value (e.g. no holdings / no computable valuation).
 * A thrown error is handled by runSnapshotBatch and counted as "failed".
 */
export type CaptureOutcome = "captured" | "skipped";

export interface BatchFailure {
  portfolioId: string;
  /** Log-safe: any secret embedded in the error string is already redacted. */
  error: string;
}

export interface BatchSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failures?: BatchFailure[];
}

/**
 * Fail-closed bearer-token auth for the cron endpoint. Returns true ONLY when a secret
 * is configured AND the request carries exactly that secret as `Bearer <secret>`.
 *
 *   secret UNSET/empty            -> false (endpoint must NEVER run unauthenticated)
 *   header missing/malformed/wrong -> false
 *
 * The compare is length-safe and constant-time (compares fixed-width SHA-256 digests),
 * so neither a length mismatch nor an early-differing byte leaks timing about the
 * secret. Collisions are cryptographically infeasible, so digest equality == secret
 * equality. The secret itself is never returned or logged here.
 */
export function authorizeCron(
  authHeader: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) return false; // fail closed: no secret configured
  if (!authHeader) return false;

  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  const provided = authHeader.slice(prefix.length);

  return constantTimeEqual(provided, secret);
}


/**
 * Value every portfolio, one snapshot per portfolio, and aggregate the outcome.
 *
 * PURE of infrastructure: the caller injects `captureFn` (the real one wraps
 * capturePortfolioSnapshot); this function only orchestrates and counts. Each
 * portfolio runs inside its own try/catch, so a single failure NEVER aborts the batch.
 *
 * Concurrency = SEQUENTIAL, deliberately. buildValuation() fans out one market-data
 * provider call per holding (+ FX) for EACH portfolio; running portfolios in parallel
 * would multiply that burst against shared provider quotas / rate limits. This is a
 * once-daily job with no latency SLA, so sequential trades wall-clock time for provider
 * safety and deterministic ordering. Re-running the same day is safe: the DB upsert
 * (@@unique([portfolioId, capturedAt])) makes each capture idempotent, so counts are
 * stable and no duplicate rows are created.
 */
export async function runSnapshotBatch<T extends { id: string }>(
  portfolios: readonly T[],
  captureFn: (portfolio: T) => Promise<CaptureOutcome>,
): Promise<BatchSummary> {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failures: BatchFailure[] = [];

  for (const portfolio of portfolios) {
    try {
      const outcome = await captureFn(portfolio);
      if (outcome === "skipped") skipped++;
      else succeeded++;
    } catch (err) {
      failed++;
      failures.push({ portfolioId: portfolio.id, error: redactSecrets(err) });
    }
  }

  return {
    processed: portfolios.length,
    succeeded,
    failed,
    skipped,
    ...(failures.length ? { failures } : {}),
  };
}
