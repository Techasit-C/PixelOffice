import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/market-data/candles", () => ({ getCandles: vi.fn() }));
vi.mock("@/lib/trading-signals/engine", () => ({ buildSignalFromCandles: vi.fn() }));

import { getCandles } from "@/lib/market-data/candles";
import { buildSignalFromCandles } from "@/lib/trading-signals/engine";
import { signalEngineStrategy, parseSignalId } from "@/lib/trading-bot/strategy";
import { TIMEFRAME_DURATION_MS, CANDLE_STALENESS_GRACE_MS } from "@/lib/trading-bot/freshness";

const NOW_ISO = "2026-07-14T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function candleAt(openTime: number) {
  return { openTime, open: 100, high: 101, low: 99, close: 100, volume: 10 };
}

function freshSeries(overrideCandleAgeMs = 60_000) {
  return {
    symbol: "BTC/USDT",
    timeframe: "4h" as const,
    candles: [candleAt(NOW_MS - overrideCandleAgeMs)],
    source: "live" as const,
    fetchedAt: NOW_MS,
  };
}

function longSignal() {
  return {
    symbol: "BTC/USDT",
    timeframe: "4h",
    direction: "LONG",
    entryZone: { low: 100, high: 110 },
    stopLoss: 90,
    takeProfit: [{ price: 130, label: "TP1" }],
    riskRewardRatio: 2,
    confidence: 70,
    reasoning: ["ok"],
    invalidationCondition: "x",
    generatedAt: NOW_ISO,
    source: "analysis",
  };
}

beforeEach(() => {
  vi.mocked(getCandles).mockReset();
  vi.mocked(buildSignalFromCandles).mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});

describe("parseSignalId", () => {
  it("parses a valid signalId", () => {
    expect(parseSignalId("BTC/USDT:4h")).toEqual({ symbol: "BTC/USDT", timeframe: "4h" });
  });
  it("rejects an unknown symbol", () => {
    expect(parseSignalId("DOGE/USDT:4h")).toBeNull();
  });
  it("rejects a non-default timeframe", () => {
    expect(parseSignalId("BTC/USDT:1h")).toBeNull();
  });
  it("rejects a malformed string", () => {
    expect(parseSignalId("garbage")).toBeNull();
  });
});

describe("SignalEngineStrategy.generateIntent", () => {
  it("rejects UNRECOGNIZED_SIGNAL for an unknown signalId", async () => {
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "DOGE/USDT:4h", NOW_ISO, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNRECOGNIZED_SIGNAL");
    expect(getCandles).not.toHaveBeenCalled();
  });

  it("rejects STALE_CANDLE_DATA when the latest candle exceeds the timeframe+grace ceiling", async () => {
    const maxAge = TIMEFRAME_DURATION_MS["4h"] + CANDLE_STALENESS_GRACE_MS;
    vi.mocked(getCandles).mockResolvedValue(freshSeries(maxAge + 1));
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", NOW_ISO, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STALE_CANDLE_DATA");
    expect(buildSignalFromCandles).not.toHaveBeenCalled();
  });

  it("does NOT reject a 3h-old candle on a 4h timeframe merely for candle age", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries(3 * 60 * 60_000));
    vi.mocked(buildSignalFromCandles).mockReturnValue(longSignal() as never);
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", NOW_ISO, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects NON_ACTIONABLE_SIGNAL for a WAIT signal", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries());
    vi.mocked(buildSignalFromCandles).mockReturnValue({ ...longSignal(), direction: "WAIT" } as never);
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", NOW_ISO, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NON_ACTIONABLE_SIGNAL");
  });

  it("rejects UNSUPPORTED_SHORT for a SHORT signal", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries());
    vi.mocked(buildSignalFromCandles).mockReturnValue({ ...longSignal(), direction: "SHORT" } as never);
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", NOW_ISO, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_SHORT");
  });

  it("rejects STALE_SIGNAL when observedGeneratedAt is older than 5 minutes", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries());
    vi.mocked(buildSignalFromCandles).mockReturnValue(longSignal() as never);
    const oldObserved = new Date(NOW_MS - 6 * 60_000).toISOString();
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", oldObserved, new Prisma.Decimal("1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STALE_SIGNAL");
  });

  it("builds a BUY TradeIntent for a fresh, actionable LONG signal within the freshness window", async () => {
    vi.mocked(getCandles).mockResolvedValue(freshSeries());
    vi.mocked(buildSignalFromCandles).mockReturnValue(longSignal() as never);
    const observed = new Date(NOW_MS - 60_000).toISOString();
    const result = await signalEngineStrategy.generateIntent(
      "user-1", "BTC/USDT:4h", observed, new Prisma.Decimal("0.5"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.side).toBe("BUY");
      expect(result.intent.symbol).toBe("BTC/USDT");
      expect(result.intent.requestedQuantity.toString()).toBe("0.5");
      expect(result.intent.sourceSignal?.stopLoss).toBe(90);
    }
  });
});
