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
import { PrismaClient } from "@prisma/client";

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
  const adminClient = new PrismaClient({ datasources: { db: { url: testUrl } } });
  try {
    await assertSchemaNotAlreadyPresent(adminClient, schemaName);

    // schemaName is derived solely from randomUUID() ("test_" + [0-9a-f]{32}), so it can
    // never contain a quote or injection character — double-quoting here is
    // defense-in-depth, not the sole protection.
    await adminClient.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);

    const after = await adminClient.$queryRawUnsafe<{ schema_name: string }[]>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      schemaName,
    );
    if (after.length !== 1) {
      throw new HarnessSafetyError("Schema creation could not be verified via information_schema.schemata.");
    }
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
  const adminClient = new PrismaClient({ datasources: { db: { url: testUrl } } });
  try {
    await adminClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await adminClient.$disconnect();
  }
}
