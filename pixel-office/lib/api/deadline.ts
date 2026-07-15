// Generic "resolve with a fallback if the promise takes too long" helper. Used to
// enforce the Phase 3 backtest route's internal deadline (55s, under the route's
// explicit 60s vercel.json maxDuration).
//
// `settled` guards against calling `onTimeout` more than once: without it, if the
// timer fires first and `promise` LATER rejects (or resolves), the rejection handler
// below would call `onTimeout` a second time even though the outer Promise had
// already settled — harmless for an idempotent callback like the route's
// `controller.abort()`, but not a guarantee this helper should silently rely on for
// every caller. `resolve()` itself is naturally a no-op once a Promise has settled,
// but the side-effecting `onTimeout()` call is not, so it must be explicitly guarded.
export function raceWithDeadline<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(onTimeout());
      },
    );
  });
}
