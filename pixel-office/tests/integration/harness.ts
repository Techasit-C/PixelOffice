// Real-Postgres isolated-schema harness for Phase 4 integration tests (design §21).
//
// SAFETY CONTRACT — read before changing anything in this file:
//   - Uses ONLY TEST_DATABASE_URL / TEST_DIRECT_DATABASE_URL. Never DATABASE_URL for any
//     schema-creating, migrating, or dropping operation.
//   - Every guard below runs BEFORE any SQL is issued, and throws HarnessSafetyError —
//     never silently substitutes DATABASE_URL, never proceeds on an ambiguous environment.
//   - No error message in this file ever contains a connection-string fragment (host,
//     port, database name, or credentials) — only categorical descriptions. This is
//     stricter than "strip credentials only": nothing URL-shaped is ever logged.
//   - Every caller of createIsolatedSchema() MUST call dropIsolatedSchema() in a
//     `finally` block, unconditionally, even on test failure.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const execAsync = promisify(exec);

// Vitest sets NODE_ENV=test, under which Next.js's own @next/env loader deliberately
// SKIPS .env.local (by design, to keep local-dev secrets out of automated test runs) —
// the opposite of what integration tests need here. This tiny, dependency-free reader
// loads .env.local unconditionally, mirroring this repo's stated zero-dependency
// preference (see scripts/check-env.mjs). It never overwrites an already-set env var,
// so a CI environment that exports these directly always takes precedence over the file.
let envLoaded = false;
/** Exported so test files can force .env.local to load before snapshotting process.env. */
export function loadDotEnvLocalOnce(): void {
  if (envLoaded) return;
  envLoaded = true;
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export class HarnessSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessSafetyError";
  }
}

interface NormalizedIdentity {
  host: string;
  port: string;
  database: string;
}

function normalizeIdentity(rawUrl: string): NormalizedIdentity {
  const u = new URL(rawUrl);
  return {
    host: u.hostname.toLowerCase(),
    port: u.port || "5432",
    database: u.pathname.replace(/^\//, "").toLowerCase(),
  };
}

function sameIdentity(a: NormalizedIdentity, b: NormalizedIdentity): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

// Prisma's default pool size is num_cpus*2+1 connections PER CLIENT INSTANCE. This
// harness's admin clients each run one or two quick queries then disconnect — a pool of
// 1 is sufficient and drastically cuts the total connection count a full test run opens
// against the disposable database, which was observed to trigger intermittent
// "can't reach database server" failures under the default pool size.
function withMinimalConnectionPool(rawUrl: string): string {
  const u = new URL(rawUrl);
  u.searchParams.set("connection_limit", "1");
  return u.toString();
}

/**
 * Retries only genuine Prisma connection-initialization failures (the observed
 * "can't reach database server" class of transient error against the disposable test
 * database) with a short bounded backoff. Never retries a HarnessSafetyError or any
 * other error — those are legitimate rejections, not transient connectivity.
 */
async function withConnectionRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isTransientConnectionError =
        err instanceof Error &&
        !(err instanceof HarnessSafetyError) &&
        (err.name === "PrismaClientInitializationError" || /can.?t reach database server/i.test(err.message));
      if (!isTransientConnectionError || attempt === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw new HarnessSafetyError("unreachable");
}

/**
 * Strips any postgres(ql):// connection string out of arbitrary text (e.g. a child
 * process's stderr) before it is ever included in a thrown error or logged — some
 * Prisma CLI error paths echo the full connection string, credentials included.
 */
function redactConnectionStrings(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-connection-string]");
}

/** Never includes a URL fragment in its thrown message — categorical only. */
function requireDistinctFromAppDatabase(candidateUrl: string, candidateLabel: string): void {
  const appUrl = process.env.DATABASE_URL;
  if (!appUrl) {
    throw new HarnessSafetyError(
      `DATABASE_URL is not set — cannot prove ${candidateLabel} is distinct from the application database. Refusing to proceed.`,
    );
  }
  let candidateIdentity: NormalizedIdentity;
  let appIdentity: NormalizedIdentity;
  try {
    candidateIdentity = normalizeIdentity(candidateUrl);
    appIdentity = normalizeIdentity(appUrl);
  } catch {
    throw new HarnessSafetyError(`${candidateLabel} or DATABASE_URL is not a valid connection string.`);
  }
  if (sameIdentity(candidateIdentity, appIdentity)) {
    throw new HarnessSafetyError(
      `${candidateLabel} resolves to the same host, port, and database as DATABASE_URL. Refusing to run test setup against a database that may be the application database.`,
    );
  }
}

/**
 * The "not created by this run" guard: throws if a schema with this name already
 * exists. Exported separately from createIsolatedSchema so it can be exercised
 * directly against a deliberately pre-existing schema in tests — with a
 * randomUUID()-derived name this branch is not otherwise reachable in normal use.
 */
export async function assertSchemaNotAlreadyPresent(client: PrismaClient, schemaName: string): Promise<void> {
  const rows = await client.$queryRawUnsafe<{ schema_name: string }[]>(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
    schemaName,
  );
  if (rows.length > 0) {
    throw new HarnessSafetyError(
      "Generated schema name already exists — refusing to reuse a schema this run did not create.",
    );
  }
}

const SCHEMA_NAME_PATTERN = /^test_[0-9a-f]{32}$/;

function generateSchemaName(): string {
  return "test_" + randomUUID().replace(/-/g, "");
}

// Prisma's `schema` URL param scopes PRISMA'S OWN generated SQL (migrate, ORM model
// queries) to the isolated schema — proven end-to-end by harness-migrate.test.ts. It
// does NOT set the Postgres session search_path GUC, so any RAW query
// ($queryRawUnsafe/$executeRawUnsafe) with an unqualified identifier still resolves
// against "public". Setting search_path via libpq's `options` connection parameter was
// tried and reverted: Neon's pooled endpoint (PgBouncer, transaction-pooling mode) does
// not reliably honor startup options, and it produced a real connection failure in
// testing. The correct, robust pattern — used throughout this harness and required of
// every future Checkpoint 3+ raw-SQL integration test — is to explicitly schema-qualify
// any raw identifier with the schemaName returned here, e.g. `"${schemaName}".paper_accounts`.
function appendSchemaParam(rawUrl: string, schemaName: string): string {
  const u = new URL(rawUrl);
  u.searchParams.set("schema", schemaName);
  return u.toString();
}

export interface IsolatedSchema {
  schemaName: string;
  testDatabaseUrl: string;
  testDirectDatabaseUrl: string;
}

/**
 * Creates one isolated Postgres schema for this run. Hard-fails before issuing any SQL
 * if either test URL is unset, either resolves to the same host/port/database as
 * DATABASE_URL, or the generated schema name is somehow already present.
 */
export async function createIsolatedSchema(): Promise<IsolatedSchema> {
  loadDotEnvLocalOnce();

  const testUrl = process.env.TEST_DATABASE_URL;
  const testDirectUrl = process.env.TEST_DIRECT_DATABASE_URL;

  if (!testUrl) {
    throw new HarnessSafetyError("TEST_DATABASE_URL is not set. Refusing to run any integration test setup.");
  }
  if (!testDirectUrl) {
    throw new HarnessSafetyError(
      "TEST_DIRECT_DATABASE_URL is not set. Refusing to run any integration test setup.",
    );
  }

  requireDistinctFromAppDatabase(testUrl, "TEST_DATABASE_URL");
  requireDistinctFromAppDatabase(testDirectUrl, "TEST_DIRECT_DATABASE_URL");

  const schemaName = generateSchemaName();
  const adminClient = new PrismaClient({ datasources: { db: { url: withMinimalConnectionPool(testUrl) } } });
  try {
    await withConnectionRetry(async () => {
      await assertSchemaNotAlreadyPresent(adminClient, schemaName);

      // schemaName is derived solely from randomUUID() ("test_" + [0-9a-f]{32}), so it
      // can never contain a quote or injection character — double-quoting here is
      // defense-in-depth, not the sole protection.
      await adminClient.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);

      const after = await adminClient.$queryRawUnsafe<{ schema_name: string }[]>(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        schemaName,
      );
      if (after.length !== 1) {
        throw new HarnessSafetyError("Schema creation could not be verified via information_schema.schemata.");
      }
    });
  } finally {
    await adminClient.$disconnect();
  }

  return {
    schemaName,
    testDatabaseUrl: appendSchemaParam(testUrl, schemaName),
    testDirectDatabaseUrl: appendSchemaParam(testDirectUrl, schemaName),
  };
}

/** Drops exactly the named schema. Must be called unconditionally from a `finally`. */
export async function dropIsolatedSchema(schemaName: string): Promise<void> {
  if (!SCHEMA_NAME_PATTERN.test(schemaName)) {
    throw new HarnessSafetyError(
      "Refusing to drop a schema name that does not match this harness's generated-name pattern.",
    );
  }
  loadDotEnvLocalOnce();
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new HarnessSafetyError("TEST_DATABASE_URL is not set. Cannot drop the isolated schema.");
  }
  const adminClient = new PrismaClient({ datasources: { db: { url: withMinimalConnectionPool(testUrl) } } });
  try {
    await withConnectionRetry(() => adminClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
  } finally {
    await adminClient.$disconnect();
  }
}

/**
 * Applies the REAL, current migration history via `prisma migrate deploy` — never
 * `db push`, never `migrate reset`. DATABASE_URL/DIRECT_URL are overridden ONLY in the
 * spawned child process's environment (a copy of process.env, never process.env
 * itself) — this process's own DATABASE_URL/DIRECT_URL are never read, written, or
 * touched. Any error text is redacted before being surfaced, since some Prisma CLI
 * failure paths echo the connection string.
 */
export async function applyMigrations(isolated: IsolatedSchema): Promise<void> {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: isolated.testDatabaseUrl,
    DIRECT_URL: isolated.testDirectDatabaseUrl,
  };
  try {
    // exec (not execFile) — the command string is a fixed literal with no interpolated
    // input, so there is no injection surface; execFile+shell:true would also work on
    // Windows (execFile alone fails with EINVAL spawning npx.cmd) but Node deprecates
    // combining an args array with shell:true, so exec's single-string form is used
    // instead.
    await execAsync("npx prisma migrate deploy", {
      cwd: process.cwd(),
      env: childEnv,
      timeout: 90_000,
    });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    throw new HarnessSafetyError(`prisma migrate deploy failed: ${redactConnectionStrings(rawMessage)}`);
  }
}

/**
 * A fresh, per-call PrismaClient pointed at the given (already schema-scoped)
 * connection string — never the app's lib/db.ts singleton, which is wired to
 * DATABASE_URL and is never imported anywhere in this file.
 */
export function createTestPrismaClient(schemaUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: schemaUrl } } });
}
