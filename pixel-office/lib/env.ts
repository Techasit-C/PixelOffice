// Environment validation — production-STRICT, dev/build-TOLERANT.
// Owner: devops-engineer. Config only; contains no business logic.
//
// DESIGN CONTRACT (must be preserved):
//   The app is built to BUILD AND BOOT WITHOUT credentials — middleware falls back
//   to passthrough when Clerk keys are absent, providers fall back to mock, and
//   portfolio routes self-enforce 401. This module MUST NOT break that path.
//
// How that contract is honored here:
//   1. NO side effects at import time. Nothing throws when this file is loaded, so
//      pulling it into a build never fails `next build` (which runs with
//      NODE_ENV=production). Validation only happens when you CALL a function.
//   2. `validateEnv()` is a PURE check — it returns a result, it never throws.
//   3. `assertEnv()` throws ONLY at real production RUNTIME (NODE_ENV=production and
//      NOT the Next.js build phase). In dev/test/build it WARNS and continues, so the
//      keyless dev/build path keeps working.
//
// This module is intentionally NOT imported by middleware.ts or lib/db.ts — those
// are on the keyless-boot hot path and must never gain a hard env dependency. Wire
// `assertEnv()` into an explicit runtime boot/health check if/when you want fail-fast
// (see docs/deployment.md). The deploy PREFLIGHT gate is scripts/check-env.mjs.
import { z } from "zod";

// Detect the Next.js production BUILD phase. During `next build`, NODE_ENV is
// "production" but we are NOT serving traffic, so strict enforcement must be skipped
// to keep the keyless build green. Next sets NEXT_PHASE=phase-production-build then.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const isProdRuntime =
  process.env.NODE_ENV === "production" && !isBuildPhase;

// Required in PRODUCTION. Each has a graceful dev fallback in the app, so these are
// only hard-required when actually serving prod traffic.
const requiredSchema = z.object({
  // Neon — pooled (app runtime). pgbouncer connection string.
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((s) => s.startsWith("postgres"), "must be a postgres:// URL"),
  // Neon — unpooled/direct. Used by `prisma migrate deploy` only.
  DIRECT_URL: z
    .string()
    .min(1)
    .refine((s) => s.startsWith("postgres"), "must be a postgres:// URL"),
  // Clerk auth. Absent => middleware passthrough + every portfolio route 401s.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  // Shared secret Vercel Cron sends as `Authorization: Bearer <CRON_SECRET>`.
  // The capture-all cron endpoint (see CR below) must verify it. Min length keeps
  // it from being a trivially guessable value.
  CRON_SECRET: z.string().min(16),
});

// Optional everywhere — missing keys degrade to cache/mock, never crash.
const optionalSchema = z.object({
  FINNHUB_API_KEY: z.string().optional(),
  COINGECKO_API_KEY: z.string().optional(),
  TRADINGVIEW_WEBHOOK_SECRET: z.string().optional(),
  BYBIT_API_KEY: z.string().optional(),
  BYBIT_API_SECRET: z.string().optional(),
  BITGET_API_KEY: z.string().optional(),
  BITGET_API_SECRET: z.string().optional(),
  BITGET_API_PASSPHRASE: z.string().optional(),
  MEXC_API_KEY: z.string().optional(),
  MEXC_API_SECRET: z.string().optional(),
  RATE_LIMIT_DISABLED: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.string().optional(),
  RATE_LIMIT_WRITE_MAX: z.string().optional(),
  RATE_LIMIT_READ_MAX: z.string().optional(),
  RATE_LIMIT_AGENTS_MAX: z.string().optional(),
  AGENTS_CACHE_TTL_MS: z.string().optional(),
});

export const envSchema = requiredSchema.merge(optionalSchema);
export type Env = z.infer<typeof envSchema>;

export interface EnvValidationResult {
  ok: boolean;
  /** Human-readable "VAR: message" lines for anything that failed. */
  errors: string[];
}

/**
 * PURE validation. Never throws. Checks the production-required vars against
 * `process.env` and returns a structured result. Safe to call from anywhere
 * (scripts, health checks, tests).
 */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): EnvValidationResult {
  const parsed = requiredSchema.safeParse(source);
  if (parsed.success) return { ok: true, errors: [] };
  const errors = parsed.error.issues.map(
    (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
  );
  return { ok: false, errors };
}

/**
 * Runtime guard. Behavior by environment:
 *   - production RUNTIME (serving traffic): THROW on any missing required var
 *     (fail fast, don't crash-loop silently on a misconfig).
 *   - dev / test / `next build`: WARN and continue (preserves keyless boot/build).
 *
 * NOTE: not auto-invoked. Import and call this from an explicit boot/health check
 * if you want fail-fast in prod; the deploy already gates on scripts/check-env.mjs.
 */
export function assertEnv(): void {
  const { ok, errors } = validateEnv();
  if (ok) return;
  const message = `[env] missing/invalid required environment variables:\n  - ${errors.join(
    "\n  - ",
  )}`;
  if (isProdRuntime) throw new Error(message);
  // dev / test / build: tolerant.
  console.warn(`${message}\n[env] continuing (non-production) — features needing these vars will degrade.`);
}
