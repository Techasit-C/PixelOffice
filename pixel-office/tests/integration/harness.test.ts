import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createIsolatedSchema,
  dropIsolatedSchema,
  assertSchemaNotAlreadyPresent,
  loadDotEnvLocalOnce,
  HarnessSafetyError,
} from "./harness";

// Force .env.local to load BEFORE snapshotting process.env, so the snapshot (restored by
// every beforeEach/afterEach below) already contains TEST_DATABASE_URL /
// TEST_DIRECT_DATABASE_URL / DATABASE_URL — otherwise resetting to a pre-load snapshot
// would wipe them, and the harness's own load-once memoization would not reload them.
loadDotEnvLocalOnce();
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("createIsolatedSchema — safety guards (no SQL should run in these cases)", () => {
  it("throws before any SQL when TEST_DATABASE_URL is unset", async () => {
    delete process.env.TEST_DATABASE_URL;
    await expect(createIsolatedSchema()).rejects.toBeInstanceOf(HarnessSafetyError);
  });

  it("throws before any SQL when TEST_DIRECT_DATABASE_URL is unset", async () => {
    delete process.env.TEST_DIRECT_DATABASE_URL;
    await expect(createIsolatedSchema()).rejects.toBeInstanceOf(HarnessSafetyError);
  });

  it("throws when TEST_DATABASE_URL resolves to the same host/port/database as DATABASE_URL", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured to run this test");
    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
    await expect(createIsolatedSchema()).rejects.toBeInstanceOf(HarnessSafetyError);
  });

  it("throws when TEST_DIRECT_DATABASE_URL resolves to the same host/port/database as DATABASE_URL", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured to run this test");
    process.env.TEST_DIRECT_DATABASE_URL = process.env.DATABASE_URL;
    await expect(createIsolatedSchema()).rejects.toBeInstanceOf(HarnessSafetyError);
  });

  it("throws when DATABASE_URL itself is unset (cannot prove distinctness)", async () => {
    delete process.env.DATABASE_URL;
    await expect(createIsolatedSchema()).rejects.toBeInstanceOf(HarnessSafetyError);
  });

  it("error messages never contain a connection-string fragment (host/port/db/credentials)", async () => {
    delete process.env.TEST_DATABASE_URL;
    try {
      await createIsolatedSchema();
      throw new Error("expected createIsolatedSchema to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toMatch(/postgres(ql)?:\/\//i);
      expect(message).not.toContain("@");
    }
  });
});

describe("assertSchemaNotAlreadyPresent — the 'not created by this run' guard", () => {
  it("throws when the named schema already exists", async () => {
    const client = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
    const preExistingName = `test_preexisting_${Date.now()}`;
    try {
      await client.$executeRawUnsafe(`CREATE SCHEMA "${preExistingName}"`);
      await expect(assertSchemaNotAlreadyPresent(client, preExistingName)).rejects.toBeInstanceOf(
        HarnessSafetyError,
      );
    } finally {
      await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${preExistingName}" CASCADE`);
      await client.$disconnect();
    }
  });

  it("does not throw when the named schema does not exist", async () => {
    const client = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
    try {
      await expect(
        assertSchemaNotAlreadyPresent(client, `test_definitely_absent_${Date.now()}`),
      ).resolves.toBeUndefined();
    } finally {
      await client.$disconnect();
    }
  });
});

describe("createIsolatedSchema / dropIsolatedSchema — happy path (real Postgres)", () => {
  it("creates a schema verifiable via information_schema.schemata, then drops it cleanly", async () => {
    const isolated = await createIsolatedSchema();
    expect(isolated.schemaName).toMatch(/^test_[0-9a-f]{32}$/);

    const verifyClient = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
    try {
      const present = await verifyClient.$queryRawUnsafe<{ schema_name: string }[]>(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        isolated.schemaName,
      );
      expect(present).toHaveLength(1);

      await dropIsolatedSchema(isolated.schemaName);

      const absent = await verifyClient.$queryRawUnsafe<{ schema_name: string }[]>(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        isolated.schemaName,
      );
      expect(absent).toHaveLength(0);
    } finally {
      await verifyClient.$disconnect();
    }
  }, 20000);

  it("both testDatabaseUrl and testDirectDatabaseUrl carry the same generated schema name", async () => {
    const isolated = await createIsolatedSchema();
    try {
      expect(new URL(isolated.testDatabaseUrl).searchParams.get("schema")).toBe(isolated.schemaName);
      expect(new URL(isolated.testDirectDatabaseUrl).searchParams.get("schema")).toBe(isolated.schemaName);
    } finally {
      await dropIsolatedSchema(isolated.schemaName);
    }
  }, 20000);
});

describe("createIsolatedSchema — concurrency", () => {
  it("two concurrent calls produce two distinct schema names, both independently torn down", async () => {
    const [a, b] = await Promise.all([createIsolatedSchema(), createIsolatedSchema()]);
    try {
      expect(a.schemaName).not.toBe(b.schemaName);

      const verifyClient = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
      try {
        const rows = await verifyClient.$queryRawUnsafe<{ schema_name: string }[]>(
          `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ($1, $2)`,
          a.schemaName,
          b.schemaName,
        );
        expect(rows).toHaveLength(2);
      } finally {
        await verifyClient.$disconnect();
      }
    } finally {
      await dropIsolatedSchema(a.schemaName);
      await dropIsolatedSchema(b.schemaName);
    }
  }, 20000);
});

describe("dropIsolatedSchema — name-pattern guard", () => {
  it("refuses to drop a schema name that does not match the generated-name pattern", async () => {
    await expect(dropIsolatedSchema("public")).rejects.toBeInstanceOf(HarnessSafetyError);
    await expect(dropIsolatedSchema("not-a-generated-name")).rejects.toBeInstanceOf(HarnessSafetyError);
  });
});
