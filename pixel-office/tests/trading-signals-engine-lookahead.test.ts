import { describe, it, expect } from "vitest";
import { buildSignalFromCandles } from "@/lib/trading-signals/engine";
import { TIMEFRAME_DURATION_MS } from "@/lib/trading-signals/candle-closed";
import type { Candle, CandleSeries } from "@/lib/market-data/candles";

const AT = "2026-07-13T00:00:00.000Z";
const AT_MS = Date.parse(AT);
const FOUR_HOUR_MS = TIMEFRAME_DURATION_MS["4h"];
const WIGGLE = 0.5;

function linspace(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1));
  return out;
}

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      openTime: AT_MS - (closes.length - i) * FOUR_HOUR_MS,
      open,
      high: Math.max(open, close) + WIGGLE,
      low: Math.min(open, close) - WIGGLE,
      close,
      volume: i === closes.length - 1 ? 500 : 100,
    };
  });
}

function series(closes: number[]): CandleSeries {
  return { symbol: "BTC/USDT", timeframe: "4h", candles: candlesFromCloses(closes), source: "live", fetchedAt: 0 };
}

function withUnclosedExtreme(base: CandleSeries, extremeClose: number): CandleSeries {
  const forming: Candle = {
    openTime: AT_MS, // opens exactly "now" -> not yet closed at analysisNow=AT_MS
    open: extremeClose,
    high: extremeClose + 10,
    low: extremeClose - 10,
    close: extremeClose,
    volume: 100_000,
  };
  return { ...base, candles: [...base.candles, forming] };
}

describe("look-ahead-bias regression — an unclosed trailing candle must never influence the signal", () => {
  it("uptrend fixture: identical output with or without an extreme unclosed candle appended", () => {
    const closes = [
      ...linspace(100, 170, 64),
      ...linspace(170, 158, 9).slice(1),
      ...linspace(158, 162, 9).slice(1),
    ];
    const base = series(closes);
    const withExtreme = withUnclosedExtreme(base, 500);
    expect(buildSignalFromCandles(withExtreme, AT)).toEqual(buildSignalFromCandles(base, AT));
  });

  it("downtrend fixture: identical output with or without an extreme unclosed candle appended", () => {
    const closes = [
      ...linspace(200, 140, 64),
      ...linspace(140, 152, 9).slice(1),
      ...linspace(152, 148, 9).slice(1),
    ];
    const base = series(closes);
    const withExtreme = withUnclosedExtreme(base, 1);
    expect(buildSignalFromCandles(withExtreme, AT)).toEqual(buildSignalFromCandles(base, AT));
  });
});
