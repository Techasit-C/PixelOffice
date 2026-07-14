// Date-range normalization and the corrected decision-bar/tradable-bar boundary model.
// Pure, deterministic, no I/O, no wall clock — every timestamp is a parameter.
export const TIMEFRAME_DURATION_MS_4H = 14_400_000;
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

export const PRIMARY_WARMUP_BARS = 60;
export const CONFIRMATION_WARMUP_BARS = 50;

export interface EvaluationWindow {
  normalizedStart: number;
  normalizedEnd: number;
  effectiveEndBoundary: number;
}

export function normalizeRange(
  requestedStart: number,
  requestedEnd: number,
  latestFullyClosedBarBoundary: number,
): EvaluationWindow {
  const normalizedStart = Math.ceil(requestedStart / TIMEFRAME_DURATION_MS_4H) * TIMEFRAME_DURATION_MS_4H;
  const normalizedEnd = Math.floor(requestedEnd / TIMEFRAME_DURATION_MS_4H) * TIMEFRAME_DURATION_MS_4H;
  const effectiveEndBoundary = Math.min(normalizedEnd, latestFullyClosedBarBoundary);
  return { normalizedStart, normalizedEnd, effectiveEndBoundary };
}

/** Step 5 (signal computation) runs only for decision bars. */
export function isDecisionBar(closeTime: number, window: EvaluationWindow): boolean {
  return closeTime >= window.normalizedStart && closeTime < window.effectiveEndBoundary;
}

/** Steps 1–4 (entry fill, gap exit, intrabar exit, equity mark) run only for tradable bars. */
export function isTradableBar(openTime: number, closeTime: number, window: EvaluationWindow): boolean {
  return (
    openTime >= window.normalizedStart &&
    openTime < window.effectiveEndBoundary &&
    closeTime <= window.effectiveEndBoundary
  );
}

export interface FetchWindow {
  fetchStartTime: number;
  fetchEndTime: number;
}

export function primaryFetchWindow(normalizedStart: number, normalizedEnd: number): FetchWindow {
  return {
    fetchStartTime: normalizedStart - PRIMARY_WARMUP_BARS * TIMEFRAME_DURATION_MS_4H,
    fetchEndTime: normalizedEnd - 1,
  };
}

export function oneHourFetchWindow(normalizedStart: number, normalizedEnd: number): FetchWindow {
  return {
    fetchStartTime: normalizedStart - CONFIRMATION_WARMUP_BARS * ONE_HOUR_MS,
    fetchEndTime: normalizedEnd - 1,
  };
}

export function oneDayFetchWindow(normalizedStart: number, normalizedEnd: number): FetchWindow {
  return {
    fetchStartTime: normalizedStart - CONFIRMATION_WARMUP_BARS * ONE_DAY_MS,
    fetchEndTime: normalizedEnd - 1,
  };
}
