import { describe, it, expect, vi } from "vitest";
import { raceWithDeadline } from "@/lib/api/deadline";

describe("raceWithDeadline", () => {
  it("resolves with the promise's value when it settles before the deadline", async () => {
    const result = await raceWithDeadline(Promise.resolve("done"), 1000, () => "timed-out");
    expect(result).toBe("done");
  });

  it("resolves with the timeout fallback when the promise is still pending at the deadline", async () => {
    vi.useFakeTimers();
    const neverResolves = new Promise<string>(() => {});
    const resultPromise = raceWithDeadline(neverResolves, 50, () => "timed-out");
    await vi.advanceTimersByTimeAsync(60);
    await expect(resultPromise).resolves.toBe("timed-out");
    vi.useRealTimers();
  });
});
