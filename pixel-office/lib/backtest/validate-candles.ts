// Historical candle validation policy. Operates on already-parsed Candle[] arrays
// (raw-row parsing/numeric-finiteness happens in lib/market-data/historical-candles.ts,
// which is outside this module's import graph). Pure, deterministic, no I/O.
import type { Candle } from "@/lib/market-data/candles";
import type { DataQualityReport } from "./types";

export interface ValidatedCandles {
  candles: Candle[];
  report: Omit<DataQualityReport, "malformedCount" | "coverageShortfall">;
}

function isOhlcSane(c: Candle): boolean {
  return (
    c.low <= c.high &&
    c.open >= c.low &&
    c.open <= c.high &&
    c.close >= c.low &&
    c.close <= c.high &&
    c.open > 0 &&
    c.high > 0 &&
    c.low > 0 &&
    c.close > 0 &&
    c.volume >= 0
  );
}

export function validateCandles(candles: Candle[], durationMs: number): ValidatedCandles {
  // 1. OHLC sanity + grid alignment — both rejected into invalidOhlcCount.
  let invalidOhlcCount = 0;
  const sane: Candle[] = [];
  for (const c of candles) {
    if (isOhlcSane(c) && c.openTime % durationMs === 0) {
      sane.push(c);
    } else {
      invalidOhlcCount++;
    }
  }

  // 2. Sort ascending by openTime; detect whether input was already sorted.
  const sorted = [...sane].sort((a, b) => a.openTime - b.openTime);
  let reorderCount = 0;
  for (let i = 0; i < sane.length; i++) {
    if (sane[i] !== sorted[i]) reorderCount++;
  }
  const reordered = reorderCount > 0;

  // 3. Duplicate timestamps: byte-identical collapse with a warning; conflicting fail.
  const byTime = new Map<number, Candle[]>();
  for (const c of sorted) {
    const group = byTime.get(c.openTime) ?? [];
    group.push(c);
    byTime.set(c.openTime, group);
  }
  let exactDuplicateCount = 0;
  let conflictingDuplicateCount = 0;
  const deduped: Candle[] = [];
  for (const openTime of [...byTime.keys()].sort((a, b) => a - b)) {
    const group = byTime.get(openTime)!;
    if (group.length === 1) {
      deduped.push(group[0]);
      continue;
    }
    const first = group[0];
    const allIdentical = group.every(
      (c) => c.open === first.open && c.high === first.high && c.low === first.low && c.close === first.close && c.volume === first.volume,
    );
    if (allIdentical) {
      exactDuplicateCount += group.length - 1;
      deduped.push(first);
    } else {
      conflictingDuplicateCount += group.length;
    }
  }

  // 4. Gap detection — never interpolated.
  const gaps: DataQualityReport["gaps"] = [];
  let gapCount = 0;
  for (let i = 0; i < deduped.length - 1; i++) {
    const delta = deduped[i + 1].openTime - deduped[i].openTime;
    if (delta !== durationMs) {
      const missingBars = Math.round(delta / durationMs) - 1;
      gaps.push({ after: deduped[i].openTime, before: deduped[i + 1].openTime, missingBars });
      gapCount += missingBars;
    }
  }

  return {
    candles: deduped,
    report: { invalidOhlcCount, exactDuplicateCount, conflictingDuplicateCount, reordered, reorderCount, gapCount, gaps },
  };
}

/**
 * Post-pagination coverage check. Returns null when the fetched candles cover the
 * requested [fetchStartTime, fetchEndTime) window (within one bar's slack at each
 * edge, to tolerate grid rounding); otherwise returns the shortfall detail.
 */
export function checkCoverage(
  candles: Candle[],
  fetchStartTime: number,
  fetchEndTime: number,
  durationMs: number,
): DataQualityReport["coverageShortfall"] {
  if (candles.length === 0) {
    return { requestedStart: fetchStartTime, requestedEnd: fetchEndTime, actualStart: null, actualEnd: null };
  }
  const actualStart = candles[0].openTime;
  const actualEnd = candles[candles.length - 1].openTime + durationMs;
  const shortfall = actualStart > fetchStartTime + durationMs || actualEnd < fetchEndTime - durationMs;
  if (!shortfall) return null;
  return { requestedStart: fetchStartTime, requestedEnd: fetchEndTime, actualStart, actualEnd };
}
