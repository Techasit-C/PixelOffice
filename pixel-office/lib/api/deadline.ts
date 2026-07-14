// Generic "resolve with a fallback if the promise takes too long" helper. Used to
// enforce the Phase 3 backtest route's internal deadline (55s, under the route's
// explicit 60s vercel.json maxDuration).
export function raceWithDeadline<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(onTimeout());
      },
    );
  });
}
