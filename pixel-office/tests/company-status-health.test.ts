// CR-MEXC-FUTURES-01 — unit tests for the pure FUTURES shaping + PnL provenance
// helpers. No I/O: every helper is deterministic given its inputs.
import { describe, it, expect } from "vitest";
import {
  shapeFuturesAccount,
  shapeFuturesPositions,
  shapeFuturesOrders,
  shapeFutures,
  resolvePnlSource,
  composeTotalPnl,
} from "@/lib/company-status/health";
import type {
  MexcFuturesAssetRaw,
  MexcFuturesPositionRaw,
  MexcFuturesOrderRaw,
} from "@/lib/exchanges/mexc";

describe("shapeFuturesAccount", () => {
  it("picks the USDT-margined row and emits 2dp money strings", () => {
    const assets: MexcFuturesAssetRaw[] = [
      { currency: "BTC", equity: 0.5, availableBalance: 0.4, unrealized: 0.01 },
      { currency: "USDT", equity: 1234.5, availableBalance: 1000, unrealized: -12.3456 },
    ];
    expect(shapeFuturesAccount(assets)).toEqual({
      walletBalance: "1234.50",
      availableBalance: "1000.00",
      unrealizedPnl: "-12.35",
    });
  });

  it("falls back to the first asset when no USDT row exists", () => {
    const assets: MexcFuturesAssetRaw[] = [
      { currency: "USDC", equity: 5, availableBalance: 5, unrealized: 0 },
    ];
    expect(shapeFuturesAccount(assets).walletBalance).toBe("5.00");
  });

  it("returns zeros for an empty/missing asset list", () => {
    expect(shapeFuturesAccount([])).toEqual({
      walletBalance: "0.00",
      availableBalance: "0.00",
      unrealizedPnl: "0.00",
    });
    expect(shapeFuturesAccount(null).walletBalance).toBe("0.00");
  });
});

describe("shapeFuturesPositions", () => {
  it("maps side codes and formats prices/uPnL, size as an integer-ish count", () => {
    const raw: MexcFuturesPositionRaw[] = [
      { symbol: "BTC_USDT", positionType: 1, holdVol: 3, holdAvgPrice: 65000, unrealized: 12.5 },
      { symbol: "ETH_USDT", positionType: 2, holdVol: 10, openAvgPrice: 3200, unrealized: -4 },
    ];
    const out = shapeFuturesPositions(raw);
    expect(out[0]).toEqual({
      symbol: "BTC_USDT",
      side: "LONG",
      size: "3",
      entryPrice: "65000.00",
      markPrice: undefined,
      unrealizedPnl: "12.50",
    });
    expect(out[1].side).toBe("SHORT");
    expect(out[1].entryPrice).toBe("3200.00"); // falls back to openAvgPrice
  });

  it("returns [] for null", () => {
    expect(shapeFuturesPositions(null)).toEqual([]);
  });
});

describe("shapeFuturesOrders", () => {
  it("maps side/type codes and formats price + vol", () => {
    const raw: MexcFuturesOrderRaw[] = [
      { symbol: "BTC_USDT", side: 1, orderType: 1, price: 60000, vol: 2, state: 2 },
    ];
    expect(shapeFuturesOrders(raw)).toEqual([
      {
        symbol: "BTC_USDT",
        side: "OPEN_LONG",
        type: "LIMIT",
        price: "60000.00",
        vol: "2",
        state: "2",
      },
    ]);
  });

  it("returns [] for null", () => {
    expect(shapeFuturesOrders(null)).toEqual([]);
  });
});

describe("shapeFutures (source resolution)", () => {
  it("null account => unavailable, positions/orders dropped", () => {
    const dto = shapeFutures(null, [{ symbol: "X", positionType: 1 }], [{ symbol: "X" }]);
    expect(dto.source).toBe("unavailable");
    expect(dto.walletBalance).toBe("0.00");
    expect(dto.positions).toEqual([]);
    expect(dto.openOrders).toEqual([]);
  });

  it("present account => live with shaped positions + orders", () => {
    const dto = shapeFutures(
      [{ currency: "USDT", equity: 100, availableBalance: 90, unrealized: 1 }],
      [{ symbol: "BTC_USDT", positionType: 1, holdVol: 1, holdAvgPrice: 50000, unrealized: 1 }],
      [{ symbol: "BTC_USDT", side: 3, orderType: 5, price: 51000, vol: 1, state: 2 }],
    );
    expect(dto.source).toBe("live");
    expect(dto.walletBalance).toBe("100.00");
    expect(dto.positions).toHaveLength(1);
    expect(dto.openOrders[0].side).toBe("OPEN_SHORT");
    expect(dto.openOrders[0].type).toBe("MARKET");
  });

  it("live account with failed positions/orders reads => live with empty lists", () => {
    const dto = shapeFutures(
      [{ currency: "USDT", equity: 50, availableBalance: 50, unrealized: 0 }],
      null,
      null,
    );
    expect(dto.source).toBe("live");
    expect(dto.positions).toEqual([]);
    expect(dto.openOrders).toEqual([]);
  });
});

describe("resolvePnlSource", () => {
  it("all live => live", () => {
    expect(
      resolvePnlSource({ futuresLive: true, realizedLive: true, cashflowLive: true }),
    ).toBe("live");
  });

  it("some live => partial (this CR's futures-only path)", () => {
    expect(
      resolvePnlSource({ futuresLive: true, realizedLive: false, cashflowLive: false }),
    ).toBe("partial");
  });

  it("none live => mock", () => {
    expect(
      resolvePnlSource({ futuresLive: false, realizedLive: false, cashflowLive: false }),
    ).toBe("mock");
  });
});

describe("composeTotalPnl", () => {
  it("futures unavailable => mock total", () => {
    expect(
      composeTotalPnl({
        futuresLive: false,
        futuresUnrealizedPnl: "999.00",
        realizedLive: false,
        realizedPnl: -1757,
        mockTotalPnl: -1035,
      }),
    ).toBe(-1035);
  });

  it("futures live, realized not live => uPnL only", () => {
    expect(
      composeTotalPnl({
        futuresLive: true,
        futuresUnrealizedPnl: "42.50",
        realizedLive: false,
        realizedPnl: -1757,
        mockTotalPnl: -1035,
      }),
    ).toBe(42.5);
  });

  it("futures live + realized live => uPnL + realized", () => {
    expect(
      composeTotalPnl({
        futuresLive: true,
        futuresUnrealizedPnl: "42.50",
        realizedLive: true,
        realizedPnl: 100,
        mockTotalPnl: -1035,
      }),
    ).toBe(142.5);
  });
});
