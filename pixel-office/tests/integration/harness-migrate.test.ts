import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createIsolatedSchema, dropIsolatedSchema, applyMigrations } from "./harness";

// The REAL, current migration history (0_init, 1_perf_and_tenant_uniqueness) — exercised
// end-to-end without needing Phase 4's own migration to exist yet (it doesn't; Checkpoint
// 3 has not started).
const EXPECTED_PORTFOLIO_TABLES = [
  "users",
  "portfolios",
  "transactions",
  "holdings",
  "assets",
  "price_snapshots",
  "dca_milestones",
  "portfolio_value_snapshots",
];

describe("applyMigrations — real migration history against an isolated schema", () => {
  it("applies the existing Portfolio-module migrations and creates their tables", async () => {
    const isolated = await createIsolatedSchema();
    try {
      await applyMigrations(isolated);

      const verifyClient = new PrismaClient({ datasources: { db: { url: isolated.testDatabaseUrl } } });
      try {
        const rows = await verifyClient.$queryRawUnsafe<{ table_name: string }[]>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
          isolated.schemaName,
        );
        const tableNames = rows.map((r) => r.table_name);
        for (const expected of EXPECTED_PORTFOLIO_TABLES) {
          expect(tableNames).toContain(expected);
        }
      } finally {
        await verifyClient.$disconnect();
      }
    } finally {
      await dropIsolatedSchema(isolated.schemaName);
    }
  }, 120000);
});
