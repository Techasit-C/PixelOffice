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

  it("calls onTimeout exactly once, even if the underlying promise later rejects", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn(() => "timed-out");
    let rejectLate: (err: Error) => void;
    const slow = new Promise<string>((_resolve, reject) => {
      rejectLate = reject;
    });
    const resultPromise = raceWithDeadline(slow, 50, onTimeout);
    await vi.advanceTimersByTimeAsync(50);
    await expect(resultPromise).resolves.toBe("timed-out");
    expect(onTimeout).toHaveBeenCalledTimes(1);

    // A late rejection of the original promise must not surface anywhere (no unhandled
    // rejection, no second resolution) — the outer Promise already settled.
    rejectLate!(new Error("late failure, must be swallowed"));
    await Promise.resolve();
    await expect(resultPromise).resolves.toBe("timed-out");
    expect(onTimeout).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("clears its internal timer on early settlement — onTimeout never fires later, no late successful result overrides the real one", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn(() => "timed-out");
    const result = await raceWithDeadline(Promise.resolve("real-value"), 1000, onTimeout);
    expect(result).toBe("real-value");

    // If the timer were not cleared, advancing far past the deadline would eventually
    // invoke onTimeout — proving cleanup, not just that the fast path happened to win.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
