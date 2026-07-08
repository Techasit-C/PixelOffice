// Shared, fail-closed shared-secret verification for machine callers (cron,
// TradingView webhook) that have NO user session — the shared secret is the only gate.
//
// One implementation so every non-Clerk caller compares secrets identically:
// length-safe, constant-time, and fail-closed when no secret is configured. The secret
// is never logged or echoed by these helpers.
import { createHash, timingSafeEqual } from "crypto";

/**
 * Length-safe, constant-time string equality via fixed-width SHA-256 digests.
 * Neither a length mismatch nor an early-differing byte leaks timing about the
 * secret; collisions are cryptographically infeasible, so digest equality ==
 * string equality.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}

/**
 * Fail-closed shared-secret check. Returns true ONLY when:
 *   - a non-empty `secret` is configured (unset/empty -> false: never run open), AND
 *   - `provided` is present and equals `secret` exactly (constant-time).
 *
 * Callers should return a GENERIC 401/403 on false — do not reveal whether the
 * secret was unset vs. mismatched, and never echo the provided or expected value.
 */
export function verifySharedSecret(
  provided: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) return false; // fail closed: no secret configured
  if (!provided) return false;
  return constantTimeEqual(provided, secret);
}
