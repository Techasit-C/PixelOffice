// Portfolio value-history persistence + read shaping (CR-004).
//
// Two responsibilities, deliberately split:
//   1. capturePortfolioSnapshot() — WRITE: value the portfolio now and upsert one
//      row per (portfolio, day). Idempotent via @@unique([portfolioId, capturedAt]),
//      so re-running the daily job (retries, backfills) never duplicates a day.
//   2. loadPerformanceSeries() + toPerformanceSeries() — READ: range-scan the
//      composite (portfolioId, capturedAt) index and map rows to the TradingView
//      Lightweight Charts shape { time: unix-seconds, value: string }.
//
// The row→series mapping (toPerformanceSeries / aggregateSnapshotSource) is PURE and
// unit-tested in isolation; the DB functions are thin wrappers over it.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { OwnedPortfolio } from "@/lib/auth/tenancy";
import {
  buildValuation,
  type BuiltValuation,
} from "./portfolio-service";
import { createMarketDataService, type MarketDataService } from "@/lib/market-data";

export type SnapshotSource = "live" | "partial" | "mock";

/** Minimal row shape the pure mappers need (subset of PortfolioValueSnapshot). */
export interface SnapshotRow {
  capturedAt: Date;
  totalValueThb: Prisma.Decimal;
  totalCostThb: Prisma.Decimal;
  unrealizedPnlThb: Prisma.Decimal;
  source: string;
}

/** A single chart point. `time` = unix SECONDS (int); `value` = numeric string. */
export interface SeriesPoint {
  time: number;
  value: string;
}

export interface PerformanceSeries {
  series: SeriesPoint[]; // primary: total value (THB)
  costSeries: SeriesPoint[]; // optional secondary: cost basis (THB)
  pnlSeries: SeriesPoint[]; // optional secondary: unrealized P&L (THB)
  source: SnapshotSource;
}

/** Truncate a Date to the start of its UTC day — the snapshot's `capturedAt` key. */
export function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** unix seconds (int) — the `time` field TradingView Lightweight Charts expects. */
function toUnixSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

/** Map ordered snapshot rows to the chart series. PURE. Assumes rows are ASC by time. */
export function toPerformanceSeries(rows: SnapshotRow[]): PerformanceSeries {
  const series: SeriesPoint[] = [];
  const costSeries: SeriesPoint[] = [];
  const pnlSeries: SeriesPoint[] = [];

  for (const r of rows) {
    const time = toUnixSeconds(r.capturedAt);
    series.push({ time, value: r.totalValueThb.toString() });
    costSeries.push({ time, value: r.totalCostThb.toString() });
    pnlSeries.push({ time, value: r.unrealizedPnlThb.toString() });
  }

  return {
    series,
    costSeries,
    pnlSeries,
    source: aggregateSnapshotSource(rows.map((r) => r.source)),
  };
}

/**
 * Honest provenance for the whole series from the per-row markers. PURE.
 * empty -> "mock" (no data); all live -> "live"; all degraded -> "mock"; else partial.
 */
export function aggregateSnapshotSource(sources: string[]): SnapshotSource {
  if (sources.length === 0) return "mock";
  const isLive = (s: string) => s === "live";
  if (sources.every(isLive)) return "live";
  if (sources.every((s) => !isLive(s))) return "mock";
  return "partial";
}

export interface LoadSeriesOptions {
  from?: Date;
  to?: Date;
  limit?: number;
}

/**
 * Read a portfolio's value history as a chart series. Range-scans the composite
 * (portfolioId, capturedAt) unique index — the WHERE + ORDER BY both ride it, so no
 * extra index and no N+1. `limit` caps rows (already validated upstream).
 */
export async function loadPerformanceSeries(
  portfolioId: string,
  opts: LoadSeriesOptions = {},
): Promise<PerformanceSeries> {
  const capturedAt: Prisma.DateTimeFilter = {};
  if (opts.from) capturedAt.gte = opts.from;
  if (opts.to) capturedAt.lte = opts.to;

  const rows = await prisma.portfolioValueSnapshot.findMany({
    where: {
      portfolioId,
      ...(opts.from || opts.to ? { capturedAt } : {}),
    },
    orderBy: { capturedAt: "asc" },
    ...(opts.limit ? { take: opts.limit } : {}),
    select: {
      capturedAt: true,
      totalValueThb: true,
      totalCostThb: true,
      unrealizedPnlThb: true,
      source: true,
    },
  });

  return toPerformanceSeries(rows);
}

/** Snapshot totals derived from a valuation — Decimal(20,2) rounded. PURE-ish helper. */
function snapshotTotals(v: BuiltValuation) {
  const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2);
  return {
    totalValueThb: r2(v.totals.marketValueBase),
    totalValueUsd: r2(v.totals.marketValueUsd),
    totalCostThb: r2(v.totals.costBasisBase),
    unrealizedPnlThb: r2(v.totals.unrealizedPnlBase),
    source: v.source,
  };
}

/**
 * Compute the portfolio's current value and upsert TODAY's snapshot (UTC day).
 * Idempotent: re-running the same day overwrites that day's row (via the
 * (portfolioId, capturedAt) unique key) rather than inserting a duplicate.
 *
 * Takes a pre-authorized OwnedPortfolio (F-06) — the auth route passes the owned
 * portfolio; the (not-yet-built) daily cron would load each portfolio server-side
 * and brand it via asSystemOwnedPortfolio().
 *
 * [CRON SEAM] No scheduler exists in this codebase. The intended production trigger
 * is a once-daily job (e.g. Vercel Cron / a GitHub Action hitting an internal route)
 * that calls this for every portfolio after US market close. Until then, capture is
 * triggered manually via POST /api/portfolios/[id]/performance.
 */
export async function capturePortfolioSnapshot(
  portfolio: OwnedPortfolio,
  market: MarketDataService = createMarketDataService(),
): Promise<{ capturedAt: Date; totals: ReturnType<typeof snapshotTotals> }> {
  const valuation = await buildValuation(portfolio, market);
  const capturedAt = startOfUtcDay(valuation.asOf);
  const totals = snapshotTotals(valuation);

  await prisma.portfolioValueSnapshot.upsert({
    where: {
      portfolioId_capturedAt: { portfolioId: portfolio.id, capturedAt },
    },
    create: { portfolioId: portfolio.id, capturedAt, ...totals },
    update: { ...totals },
  });

  return { capturedAt, totals };
}
