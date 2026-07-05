-- Migration: 1_perf_and_tenant_uniqueness
-- Incremental on top of 0_init (0_init generated offline, NEVER applied to any DB).
--
-- CR-003 F-01 (SECURITY): Transaction import-idempotency uniqueness was GLOBAL
--   ("source", "externalId"), letting one tenant squat a (source, externalId) pair
--   and block/probe another tenant's import (cross-tenant DoS + existence oracle).
--   Re-scoped to ("portfolioId", "source", "externalId") so dedupe is per-portfolio.
--   NULLs remain exempt from the partial unique in Postgres — manual entries (source
--   / externalId NULL) are unaffected.
--
-- CR-004 (FEATURE): New "portfolio_value_snapshots" time-series table backing the
--   historical performance chart. One row per (portfolioId, capturedAt) instant.
--
-- Backward compatibility: both changes are safe on the greenfield/empty schema.
--   The DROP+CREATE of the Transaction unique index and the pure CREATE TABLE take
--   only brief metadata locks and touch zero existing rows (no live data exists).

-- DropIndex
DROP INDEX "transactions_source_externalId_key";

-- CreateTable
CREATE TABLE "portfolio_value_snapshots" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "totalValueThb" DECIMAL(20,2) NOT NULL,
    "totalValueUsd" DECIMAL(20,2) NOT NULL,
    "totalCostThb" DECIMAL(20,2) NOT NULL,
    "unrealizedPnlThb" DECIMAL(20,2) NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_value_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_value_snapshots_portfolioId_capturedAt_key" ON "portfolio_value_snapshots"("portfolioId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_portfolioId_source_externalId_key" ON "transactions"("portfolioId", "source", "externalId");

-- AddForeignKey
ALTER TABLE "portfolio_value_snapshots" ADD CONSTRAINT "portfolio_value_snapshots_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
