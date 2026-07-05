// CR-003 F-02: rate limiter behavior — allows N, blocks N+1, resets after window.
import { describe, it, expect } from "vitest";
import { InMemoryRateLimiter } from "@/lib/api/rate-limit";

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
