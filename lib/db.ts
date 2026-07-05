import { PrismaClient } from "@prisma/client";

// Prisma client singleton. Next.js dev hot-reload re-evaluates modules and would
// otherwise spawn a new PrismaClient per reload, exhausting the DB connection
// pool. Caching the instance on globalThis in non-production avoids that.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
