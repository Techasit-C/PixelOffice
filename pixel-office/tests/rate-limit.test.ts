// CR-003 F-02: rate limiter behavior — allows N, blocks N+1, resets after window.
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  InMemoryRateLimiter,
  enforceRateLimit,
  __resetRateLimiters,
} from "@/lib/api/rate-limit";
import { TooManyRequests } from "@/lib/api/errors";

describe("InMemoryRateLimiter (fixed window)", () => {
  it("allows up to the limit, then blocks with a Retry-After hint", () => {
    const now = 1000;
    const rl = new InMemoryRateLimiter(3, 1000, () => now);

    expect(rl.check("user-1").allowed).toBe(true);
    expect(rl.check("user-1").allowed).toBe(true);
    const third = rl.check("user-1");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const blocked = rl.check("user-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("isolates budgets per key (one user cannot exhaust another's)", () => {
    const now = 0;
    const rl = new InMemoryRateLimiter(1, 1000, () => now);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false); // a exhausted
    expect(rl.check("b").allowed).toBe(true); // b unaffected
  });

  it("resets once the window elapses", () => {
    let now = 0;
    const rl = new InMemoryRateLimiter(2, 1000, () => now);
    expect(rl.check("u").allowed).toBe(true);
    expect(rl.check("u").allowed).toBe(true);
    expect(rl.check("u").allowed).toBe(false); // blocked within window

    now += 1000; // advance past the window
    expect(rl.check("u").allowed).toBe(true); // fresh window
  });
});

// Sprint 5: the /api/agents roster read bucket. Additive to the existing buckets.
describe("enforceRateLimit — agentsRead bucket", () => {
  const prevMax = process.env.RATE_LIMIT_AGENTS_MAX;

  beforeEach(() => {
    __resetRateLimiters();
    process.env.RATE_LIMIT_AGENTS_MAX = "3"; // small, deterministic threshold
  });

  afterEach(() => {
    if (prevMax === undefined) delete process.env.RATE_LIMIT_AGENTS_MAX;
    else process.env.RATE_LIMIT_AGENTS_MAX = prevMax;
    __resetRateLimiters();
  });

  it("allows up to the configured max, then throws TooManyRequests (429)", () => {
    for (let i = 0; i < 3; i++) {
      expect(() => enforceRateLimit("user-1", "agentsRead")).not.toThrow();
    }
    expect(() => enforceRateLimit("user-1", "agentsRead")).toThrow(TooManyRequests);
  });

  it("isolates the agentsRead budget per user", () => {
    for (let i = 0; i < 3; i++) enforceRateLimit("user-1", "agentsRead");
    // user-1 is exhausted; user-2 has a full, independent budget.
    expect(() => enforceRateLimit("user-2", "agentsRead")).not.toThrow();
  });

  it("does not share a budget with the write bucket for the same user", () => {
    for (let i = 0; i < 3; i++) enforceRateLimit("user-1", "agentsRead");
    // agentsRead is spent, but write is a separate bucket and still open.
    expect(() => enforceRateLimit("user-1", "write")).not.toThrow();
  });
});
