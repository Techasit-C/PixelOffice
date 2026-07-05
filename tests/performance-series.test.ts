// CR-004: performance series shaping — rows -> { time: unix seconds, value: string }
// in order, with honest aggregate source. Pure functions only (no DB).
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  toPerformanceSeries,
  aggregateSnapshotSource,
  startOfUtcDay,
  type SnapshotRow,
} from "@/lib/portfolio/snapshot-service";

const D = (s: string) => new Prisma.Decimal(s);
const row = (
  iso: string,
  value: string,
  cost: string,
  pnl: string,
  source: string,
): SnapshotRow => ({
  capturedAt: new Date(iso),
  totalValueThb: D(value),
  totalCostThb: D(cost),
  unrealizedPnlThb: D(pnl),
  source,
});

describe("toPerformanceSeries", () => {
  it("maps rows to {time: unix seconds, value: string} preserving order", () => {
    const rows = [
      row("2026-01-01T00:00:00Z", "1000.50", "900", "100.50", "live"),
      row("2026-01-02T00:00:00Z", "1100.00", "900", "200", "live"),
    ];
    const out = toPerformanceSeries(rows);

    expect(out.series).toEqual([
      { time: Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000), value: "1000.5" },
      { time: Math.floor(Date.parse("2026-01-02T00:00:00Z") / 1000), value: "1100" },
    ]);
    // time is an integer number of seconds, value is a string.
    for (const p of out.series) {
      expect(Number.isInteger(p.time)).toBe(true);
      expect(typeof p.value).toBe("string");
    }
  });

  it("exposes optional cost and pnl secondary series aligned by time", () => {
    const rows = [row("2026-01-01T00:00:00Z", "1000", "900", "100", "live")];
    const out = toPerformanceSeries(rows);
    const t = Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000);
    expect(out.costSeries).toEqual([{ time: t, value: "900" }]);
    expect(out.pnlSeries).toEqual([{ time: t, value: "100" }]);
  });

  it("empty input -> empty series, source 'mock'", () => {
    const out = toPerformanceSeries([]);
    expect(out.series).toEqual([]);
    expect(out.source).toBe("mock");
  });
});

describe("aggregateSnapshotSource", () => {
  it("all live -> live", () => {
    expect(aggregateSnapshotSource(["live", "live"])).toBe("live");
  });
  it("mixed -> partial", () => {
    expect(aggregateSnapshotSource(["live", "cache"])).toBe("partial");
  });
  it("all degraded -> mock", () => {
    expect(aggregateSnapshotSource(["mock", "cache"])).toBe("mock");
  });
  it("empty -> mock", () => {
    expect(aggregateSnapshotSource([])).toBe("mock");
  });
});

describe("startOfUtcDay", () => {
  it("truncates to UTC midnight (the capturedAt day key)", () => {
    expect(startOfUtcDay(new Date("2026-07-06T15:30:45.123Z")).toISOString()).toBe(
      "2026-07-06T00:00:00.000Z",
    );
  });
});
