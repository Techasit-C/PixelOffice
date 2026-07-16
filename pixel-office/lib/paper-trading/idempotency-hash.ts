// Canonical payload construction and idempotency hashing (design §13/§7 step 4).
// Sorted-key JSON, Decimal values normalized to fixed 8dp strings, UTF-8, no whitespace,
// SHA-256 hex, versioned via hashVersion so a future canonicalization change never
// reinterprets an old row's already-stored hash.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { toDecimalString } from "./serialize";
import type { PaperOrderSide } from "./types";

export const HASH_VERSION = "v1";

export interface CanonicalOrderPayload {
  commandType: "ORDER";
  side: PaperOrderSide;
  symbol: string;
  normalizedQuantity: string;
  expectedGeneration: number;
}

export function canonicalOrderPayload(params: {
  side: PaperOrderSide;
  symbol: string;
  quantity: Prisma.Decimal;
  expectedGeneration: number;
}): CanonicalOrderPayload {
  return {
    commandType: "ORDER",
    side: params.side,
    symbol: params.symbol,
    normalizedQuantity: toDecimalString(params.quantity),
    expectedGeneration: params.expectedGeneration,
  };
}

export interface CanonicalResetPayload {
  commandType: "RESET";
  expectedGeneration: number;
}

export function canonicalResetPayload(params: { expectedGeneration: number }): CanonicalResetPayload {
  return { commandType: "RESET", expectedGeneration: params.expectedGeneration };
}

export type StopCommandType = "EMERGENCY_STOP_ACTIVATE" | "EMERGENCY_STOP_RESUME";

export interface CanonicalStopPayload {
  commandType: StopCommandType;
  expectedGeneration: number;
  reason?: string;
}

export function canonicalStopPayload(params: {
  commandType: StopCommandType;
  expectedGeneration: number;
  reason?: string;
}): CanonicalStopPayload {
  const payload: CanonicalStopPayload = {
    commandType: params.commandType,
    expectedGeneration: params.expectedGeneration,
  };
  if (params.reason !== undefined) payload.reason = params.reason;
  return payload;
}

export interface HashedPayload {
  payloadHash: string;
  hashVersion: string;
}

// `object` (not Record<string, unknown>) so any concrete canonical-payload interface
// (CanonicalOrderPayload, CanonicalResetPayload, CanonicalStopPayload, or a plain test
// fixture) is directly assignable without an artificial index signature.
function canonicalize(payload: object): string {
  const record = payload as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return JSON.stringify(sorted);
}

export function hashPayload(payload: object): HashedPayload {
  const payloadHash = createHash("sha256").update(canonicalize(payload), "utf8").digest("hex");
  return { payloadHash, hashVersion: HASH_VERSION };
}
