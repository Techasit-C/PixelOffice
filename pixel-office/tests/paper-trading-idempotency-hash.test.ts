import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  canonicalOrderPayload,
  canonicalResetPayload,
  canonicalStopPayload,
  hashPayload,
} from "@/lib/paper-trading/idempotency-hash";

describe("hashPayload — canonicalization", () => {
  it("produces the identical hash regardless of object key insertion order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(hashPayload(a).payloadHash).toBe(hashPayload(b).payloadHash);
  });

  it("stamps hashVersion 'v1'", () => {
    const result = hashPayload(canonicalResetPayload({ expectedGeneration: 1 }));
    expect(result.hashVersion).toBe("v1");
  });
});

describe("canonicalOrderPayload + hashPayload", () => {
  const base = () =>
    canonicalOrderPayload({
      side: "BUY",
      symbol: "BTCUSDT",
      quantity: new Prisma.Decimal("1.5"),
      expectedGeneration: 1,
    });

  it("changes the hash when side changes", () => {
    const baseHash = hashPayload(base()).payloadHash;
    const changed = { ...base(), side: "SELL" as const };
    expect(hashPayload(changed).payloadHash).not.toBe(baseHash);
  });

  it("changes the hash when symbol changes", () => {
    const baseHash = hashPayload(base()).payloadHash;
    const changed = { ...base(), symbol: "ETHUSDT" };
    expect(hashPayload(changed).payloadHash).not.toBe(baseHash);
  });

  it("changes the hash when quantity changes", () => {
    const baseHash = hashPayload(base()).payloadHash;
    const changed = { ...base(), normalizedQuantity: "1.60000000" };
    expect(hashPayload(changed).payloadHash).not.toBe(baseHash);
  });

  it("changes the hash when expectedGeneration changes", () => {
    const baseHash = hashPayload(base()).payloadHash;
    const changed = { ...base(), expectedGeneration: 2 };
    expect(hashPayload(changed).payloadHash).not.toBe(baseHash);
  });

  it("normalizes quantity to 8dp before hashing — 1.5 and 1.50000000 hash identically", () => {
    const short = canonicalOrderPayload({
      side: "BUY",
      symbol: "BTCUSDT",
      quantity: new Prisma.Decimal("1.5"),
      expectedGeneration: 1,
    });
    const long = canonicalOrderPayload({
      side: "BUY",
      symbol: "BTCUSDT",
      quantity: new Prisma.Decimal("1.50000000"),
      expectedGeneration: 1,
    });
    expect(hashPayload(short).payloadHash).toBe(hashPayload(long).payloadHash);
  });
});

describe("canonicalResetPayload + hashPayload", () => {
  it("changes hash when expectedGeneration changes", () => {
    const g1 = hashPayload(canonicalResetPayload({ expectedGeneration: 1 })).payloadHash;
    const g2 = hashPayload(canonicalResetPayload({ expectedGeneration: 2 })).payloadHash;
    expect(g1).not.toBe(g2);
  });
});

describe("canonicalStopPayload + hashPayload", () => {
  it("distinguishes activate from resume even with the same generation", () => {
    const activate = hashPayload(
      canonicalStopPayload({ commandType: "EMERGENCY_STOP_ACTIVATE", expectedGeneration: 1 }),
    ).payloadHash;
    const resume = hashPayload(
      canonicalStopPayload({ commandType: "EMERGENCY_STOP_RESUME", expectedGeneration: 1 }),
    ).payloadHash;
    expect(activate).not.toBe(resume);
  });

  it("omits the reason field entirely when not supplied, rather than hashing undefined", () => {
    const payload = canonicalStopPayload({ commandType: "EMERGENCY_STOP_ACTIVATE", expectedGeneration: 1 });
    expect(Object.prototype.hasOwnProperty.call(payload, "reason")).toBe(false);
  });

  it("changes hash when a reason is supplied vs. omitted", () => {
    const withoutReason = hashPayload(
      canonicalStopPayload({ commandType: "EMERGENCY_STOP_ACTIVATE", expectedGeneration: 1 }),
    ).payloadHash;
    const withReason = hashPayload(
      canonicalStopPayload({
        commandType: "EMERGENCY_STOP_ACTIVATE",
        expectedGeneration: 1,
        reason: "manual halt",
      }),
    ).payloadHash;
    expect(withoutReason).not.toBe(withReason);
  });
});
