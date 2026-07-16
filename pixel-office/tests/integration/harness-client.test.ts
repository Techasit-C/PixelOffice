import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createIsolatedSchema, dropIsolatedSchema, createTestPrismaClient } from "./harness";

describe("createTestPrismaClient", () => {
  // Prisma's `schema` URL param does not set the Postgres session search_path (see the
  // comment on appendSchemaParam in harness.ts) — so this proves the honest, meaningful
  // claim: a client created from testDatabaseUrl can create/write/read a table WITHIN
  // the isolated schema when the raw SQL explicitly schema-qualifies it, exactly the
  // pattern every future Checkpoint 3+ raw-SQL integration test will use.
  it("can create, write, and read a schema-qualified table within the isolated schema", async () => {
    const isolated = await createIsolatedSchema();
    const client = createTestPrismaClient(isolated.testDatabaseUrl);
    try {
      const qualified = `"${isolated.schemaName}".harness_marker`;
      await client.$executeRawUnsafe(`CREATE TABLE ${qualified} (id int)`);
      await client.$executeRawUnsafe(`INSERT INTO ${qualified} (id) VALUES (1)`);
      const rows = await client.$queryRawUnsafe<{ id: number }[]>(`SELECT id FROM ${qualified}`);
      expect(rows).toEqual([{ id: 1 }]);
    } finally {
      await client.$disconnect();
      await dropIsolatedSchema(isolated.schemaName);
    }
  }, 20000);

  it("returns a fresh client instance on every call, never a shared singleton", async () => {
    const isolated = await createIsolatedSchema();
    try {
      const clientA = createTestPrismaClient(isolated.testDatabaseUrl);
      const clientB = createTestPrismaClient(isolated.testDatabaseUrl);
      try {
        expect(clientA).not.toBe(clientB);
      } finally {
        await clientA.$disconnect();
        await clientB.$disconnect();
      }
    } finally {
      await dropIsolatedSchema(isolated.schemaName);
    }
  }, 20000);
});

describe("harness independence from lib/db.ts", () => {
  it("harness.ts never imports the app's shared PrismaClient singleton (lib/db.ts)", () => {
    const harnessSource = fs.readFileSync(path.join(process.cwd(), "tests/integration/harness.ts"), "utf8");
    expect(harnessSource).not.toMatch(/^\s*import[^\n]*["'][^"']*lib\/db["'][^\n]*$/m);
  });
});
