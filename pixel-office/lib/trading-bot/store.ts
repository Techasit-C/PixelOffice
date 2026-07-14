// Per-user in-memory store for the Phase 1 mock trading pipeline.
//
// DEPLOYMENT-SAFETY CAVEAT: this is a module-scoped Map<userId, ...>. It is
// correct in a single warm Node process (local dev, a single long-lived
// server instance) but is NOT safe on serverless/multi-instance deployment
// (e.g. Vercel functions): concurrent requests may land on different
// instances, each with its own empty map, silently losing or duplicating
// state. This mirrors the existing, already-documented caveat on
// lib/api/rate-limit.ts and lib/agents/agents-cache.ts. Phase 4 replaces this
// with Postgres-backed persistence.
import { PAPER_STARTING_BALANCE_USDT } from "./config";
import type { MockAccount, MockPosition, OrderResult } from "./types";

interface StoreEntry {
  account: MockAccount;
  idempotency: Map<string, OrderResult>;
}

const store = new Map<string, StoreEntry>();
const locks = new Map<string, Promise<unknown>>();

function createEntry(userId: string): StoreEntry {
  return {
    account: {
      userId,
      cashBalance: PAPER_STARTING_BALANCE_USDT,
      startingBalance: PAPER_STARTING_BALANCE_USDT,
      positions: new Map<string, MockPosition>(),
    },
    idempotency: new Map<string, OrderResult>(),
  };
}

function getEntry(userId: string): StoreEntry {
  let entry = store.get(userId);
  if (!entry) {
    entry = createEntry(userId);
    store.set(userId, entry);
  }
  return entry;
}

/** Returns the SAME mutable object every time for a given userId. */
export function getAccountForUser(userId: string): MockAccount {
  return getEntry(userId).account;
}

export function getIdempotentResult(userId: string, key: string): OrderResult | undefined {
  return getEntry(userId).idempotency.get(key);
}

export function storeIdempotentResult(userId: string, key: string, result: OrderResult): void {
  getEntry(userId).idempotency.set(key, result);
}

/**
 * Per-user promise-chained mutex: serializes mutating calls for a given user
 * so two concurrent requests with the same idempotency key can't both pass a
 * check-then-act race. Only protects within this single Node process.
 */
export function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(userId) ?? Promise.resolve();
  const next = prior.then(() => fn(), () => fn());
  // A failed call must not wedge the lock for the next caller.
  locks.set(userId, next.then(() => undefined, () => undefined));
  return next;
}

/** Test seam: clear all in-memory state between cases. */
export function __resetTradingBotStore(): void {
  store.clear();
  locks.clear();
}
