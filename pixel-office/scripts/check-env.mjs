#!/usr/bin/env node
// Deploy PREFLIGHT env gate. Owner: devops-engineer.
//
// Purpose: fail a deploy BEFORE it ships if a production-required env var is
// missing/blank. This runs as an explicit step in the deploy checklist
// (docs/deployment.md) — it is deliberately separate from the app so it can NEVER
// break the keyless dev/build path (nothing in the app graph imports it).
//
// Zero dependencies (plain Node) so it runs in any CI/preflight context without a
// TS loader. Keep REQUIRED in sync with the requiredSchema in lib/env.ts.
//
// Usage:
//   node scripts/check-env.mjs            # checks process.env (Vercel/CI supplies it)
//   node scripts/check-env.mjs --prod     # force strict (exit 1 on any miss)
//
// By default it is strict when NODE_ENV=production, warn-only otherwise — mirroring
// lib/env.ts. Pass --prod to force strict locally.

const REQUIRED = [
  "DATABASE_URL", // Neon pooled (pgbouncer) — app runtime
  "DIRECT_URL", // Neon unpooled/direct — prisma migrate deploy
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", // Clerk (absent => 401 on all portfolio routes)
  "CLERK_SECRET_KEY",
  "CRON_SECRET", // Vercel Cron Authorization: Bearer <CRON_SECRET>
];

const forceStrict = process.argv.includes("--prod");
const strict = forceStrict || process.env.NODE_ENV === "production";

const missing = REQUIRED.filter((k) => {
  const v = process.env[k];
  return v === undefined || v === null || String(v).trim() === "";
});

// Light sanity checks (non-fatal warnings) for the vars that ARE present.
const warnings = [];
for (const k of ["DATABASE_URL", "DIRECT_URL"]) {
  const v = process.env[k];
  if (v && !v.startsWith("postgres")) warnings.push(`${k} does not look like a postgres:// URL`);
}
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("pgbouncer") && !process.env.DATABASE_URL.includes("-pooler")) {
  warnings.push("DATABASE_URL is not obviously the POOLED Neon string (expected '-pooler' host or pgbouncer=true)");
}
if (process.env.DIRECT_URL && (process.env.DIRECT_URL.includes("pgbouncer=true") || process.env.DIRECT_URL.includes("-pooler"))) {
  warnings.push("DIRECT_URL looks POOLED — prisma migrate needs the UNPOOLED/direct host");
}
if (process.env.CRON_SECRET && process.env.CRON_SECRET.length < 16) {
  warnings.push("CRON_SECRET is shorter than 16 chars — use a stronger secret");
}

for (const w of warnings) console.warn(`[check-env] WARN: ${w}`);

if (missing.length === 0) {
  console.log("[check-env] OK — all production-required env vars are present.");
  process.exit(0);
}

const list = missing.map((k) => `  - ${k}`).join("\n");
if (strict) {
  console.error(`[check-env] FAIL — missing required env vars:\n${list}`);
  process.exit(1);
}
console.warn(`[check-env] WARN (non-production) — missing required env vars:\n${list}`);
process.exit(0);
