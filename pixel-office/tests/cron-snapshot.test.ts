// CR (cron seam): /api/cron/snapshot core logic. Covers fail-closed bearer auth and
// the batch aggregator — no DB, no providers, no Next request pipeline (capture is
// injected/mocked, portfolio list is a fixture), matching the pure-unit vitest setup.
import { describe, it, expect, vi } from "vitest";
import {
  authorizeCron,
  runSnapshotBatch,
  type CaptureOutcome,
} from "@/lib/cron/snapshot-batch";

const SECRET = "s3cr3t-cron-token";

describe("authorizeCron — fail-closed bearer auth", () => {
  it("rejects when CRON_SECRET is UNSET even with a plausible header", () => {
    expect(authorizeCron(`Bearer ${SECRET}`, undefined)).toBe(false);
  });

  it("rejects when CRON_SECRET is an empty string (fail closed)", () => {
    expect(authorizeCron(`Bearer ${SECRET}`, "")).toBe(false);
  });

  it("rejects a missing/null Authorization header", () => {
    expect(authorizeCron(null, SECRET)).toBe(false);
    expect(authorizeCron(undefined, SECRET)).toBe(false);
  });

  it("rejects a malformed header (no Bearer scheme)", () => {
    expect(authorizeCron(SECRET, SECRET)).toBe(false);
    expect(authorizeCron(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(authorizeCron("Bearer wrong-token", SECRET)).toBe(false);
  });

  it("rejects a secret that is a prefix of the real one (length-safe compare)", () => {
    expect(authorizeCron(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
  });

  it("accepts the exact correct bearer token", () => {
    expect(authorizeCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });
});

type P = { id: string };
const portfolios: P[] = [
  { id: "p1" },
  { id: "p2" },
  { id: "p3" },
  { id: "p4" },
];

describe("runSnapshotBatch — aggregation", () => {
  it("counts a mix of captured / skipped / failed correctly", async () => {
    const capture = async (p: P): Promise<CaptureOutcome> => {
      if (p.id === "p2") return "skipped";
      if (p.id === "p3") throw new Error("provider exploded");
      return "captured";
    };

    const summary = await runSnapshotBatch(portfolios, capture);

    expect(summary.processed).toBe(4);
    expect(summary.succeeded).toBe(2); // p1, p4
    expect(summary.skipped).toBe(1); // p2
    expect(summary.failed).toBe(1); // p3
    expect(summary.failures).toEqual([
      { portfolioId: "p3", error: expect.stringContaining("provider exploded") },
    ]);
  });

  it("does NOT abort the batch when one portfolio throws — later ones still run", async () => {
    const seen: string[] = [];
    const capture = async (p: P): Promise<CaptureOutcome> => {
      seen.push(p.id);
      if (p.id === "p1") throw new Error("boom on the FIRST one");
      return "captured";
    };

    const summary = await runSnapshotBatch(portfolios, capture);

    // Every portfolio was attempted despite p1 throwing first.
    expect(seen).toEqual(["p1", "p2", "p3", "p4"]);
    expect(summary.processed).toBe(4);
    expect(summary.succeeded).toBe(3);
    expect(summary.failed).toBe(1);
  });

  it("omits the failures key entirely when nothing fails", async () => {
    const summary = await runSnapshotBatch(portfolios, async () => "captured");
    expect(summary).toEqual({
      processed: 4,
      succeeded: 4,
      failed: 0,
      skipped: 0,
    });
    expect(summary.failures).toBeUndefined();
  });

  it("handles an empty portfolio list (all zeros, no failures)", async () => {
    const summary = await runSnapshotBatch([], async () => "captured");
    expect(summary).toEqual({ processed: 0, succeeded: 0, failed: 0, skipped: 0 });
  });

  it("redacts secrets embedded in a thrown error's message", async () => {
    const capture = async (): Promise<CaptureOutcome> => {
      throw new Error("GET https://api.example/quote?token=SUPERSECRET failed");
    };
    const summary = await runSnapshotBatch([{ id: "p1" }], capture);
    const msg = summary.failures![0].error;
    expect(msg).toContain("token=[REDACTED]");
    expect(msg).not.toContain("SUPERSECRET");
  });

  it("calls the capture fn exactly once per portfolio, and re-runs are idempotent by count", async () => {
    // Idempotency lives in the DB upsert (@@unique[portfolioId, capturedAt]); the batch
    // itself must not fan out or duplicate work. A mock stands in for that upsert.
    const capture = vi.fn(async (): Promise<CaptureOutcome> => "captured");

    const first = await runSnapshotBatch(portfolios, capture);
    expect(capture).toHaveBeenCalledTimes(4); // one call per portfolio, no duplicates

    const second = await runSnapshotBatch(portfolios, capture);
    // A second same-day run produces an identical summary (upsert -> no new rows).
    expect(second).toEqual(first);
    expect(capture).toHaveBeenCalledTimes(8); // 4 + 4, still one per portfolio per run
  });
});
