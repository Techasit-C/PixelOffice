// Pure, side-effect-free shaping helpers + DTO types for /api/company-status.
//
// NO fetch, NO env reads, NO logging here — every function is deterministic given
// its inputs so the shaping logic is unit-testable in isolation. The route owns all
// I/O; this module only turns raw provider payloads into wire-safe DTOs and resolves
// honest source flags. Money is emitted as `.toFixed(2)` strings, counts as strings
// of integers, per the wire contract.

import type {
  MexcFuturesAssetRaw,
  MexcFuturesPositionRaw,
  MexcFuturesOrderRaw,
} from "@/lib/exchanges/mexc";
import type { MexcFuturesPosition, MexcFuturesOrder } from "@/lib/mock-data";

export type FuturesSource = "live" | "mock" | "pending" | "unavailable";
export type PnlSource = "live" | "partial" | "mock" | "unavailable";

export interface FuturesDTO {
  source: FuturesSource;
  walletBalance: string;
  availableBalance: string;
  unrealizedPnl: string;
  positions: MexcFuturesPosition[];
  openOrders: MexcFuturesOrder[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Money on the wire = 2dp string. */
function money(v: unknown): string {
  return num(v).toFixed(2);
}

/** A count on the wire = plain integer-ish string (no forced decimals). */
function count(v: unknown): string {
  return String(num(v));
}

function mapPositionSide(positionType: number | undefined): string {
  if (positionType === 1) return "LONG";
  if (positionType === 2) return "SHORT";
  return "—";
}

function mapOrderSide(side: number | undefined): string {
  switch (side) {
    case 1:
      return "OPEN_LONG";
    case 2:
      return "CLOSE_SHORT";
    case 3:
      return "OPEN_SHORT";
    case 4:
      return "CLOSE_LONG";
    default:
      return "—";
  }
}

function mapOrderType(orderType: number | undefined): string {
  switch (orderType) {
    case 1:
      return "LIMIT";
    case 5:
      return "MARKET";
    default:
      return orderType === undefined ? "—" : String(orderType);
  }
}

/** Aggregate the USDT-margined asset row into wallet/available/uPnL strings. */
export function shapeFuturesAccount(
  assets: MexcFuturesAssetRaw[] | null | undefined,
): { walletBalance: string; availableBalance: string; unrealizedPnl: string } {
  const list = assets ?? [];
  const primary = list.find((a) => a.currency === "USDT") ?? list[0];
  return {
    walletBalance: money(primary?.equity),
    availableBalance: money(primary?.availableBalance),
    unrealizedPnl: money(primary?.unrealized),
  };
}

export function shapeFuturesPositions(
  raw: MexcFuturesPositionRaw[] | null | undefined,
): MexcFuturesPosition[] {
  return (raw ?? []).map((p) => ({
    symbol: String(p.symbol ?? ""),
    side: mapPositionSide(p.positionType),
    size: count(p.holdVol),
    entryPrice: money(p.holdAvgPrice ?? p.openAvgPrice),
    markPrice: p.markPrice === undefined ? undefined : money(p.markPrice),
    unrealizedPnl: money(p.unrealized),
  }));
}

export function shapeFuturesOrders(
  raw: MexcFuturesOrderRaw[] | null | undefined,
): MexcFuturesOrder[] {
  return (raw ?? []).map((o) => ({
    symbol: String(o.symbol ?? ""),
    side: mapOrderSide(o.side),
    type: mapOrderType(o.orderType),
    price: money(o.price),
    vol: count(o.vol),
    state: o.state === undefined ? "—" : String(o.state),
  }));
}

/**
 * Compose the FUTURES DTO. The account payload is the source-of-truth: if it is
 * null (missing key / permission / signature failure), the whole section is
 * `unavailable` and positions/orders are dropped — we never surface a half-live
 * section. Positions/orders individually default to [] when their read failed.
 */
export function shapeFutures(
  assets: MexcFuturesAssetRaw[] | null,
  positions: MexcFuturesPositionRaw[] | null,
  orders: MexcFuturesOrderRaw[] | null,
): FuturesDTO {
  if (assets === null) {
    return {
      source: "unavailable",
      walletBalance: "0.00",
      availableBalance: "0.00",
      unrealizedPnl: "0.00",
      positions: [],
      openOrders: [],
    };
  }
  return {
    source: "live",
    ...shapeFuturesAccount(assets),
    positions: shapeFuturesPositions(positions),
    openOrders: shapeFuturesOrders(orders),
  };
}

/**
 * Honest PnL provenance. "live" only when EVERY component is from a real MEXC read
 * endpoint; "partial" when some are; "mock" when none are (we still show mock
 * numbers). Callers pass a flag per component so this never over-claims.
 */
export function resolvePnlSource(input: {
  futuresLive: boolean;
  realizedLive: boolean;
  cashflowLive: boolean;
}): PnlSource {
  const flags = [input.futuresLive, input.realizedLive, input.cashflowLive];
  const liveCount = flags.filter(Boolean).length;
  if (liveCount === flags.length) return "live";
  if (liveCount > 0) return "partial";
  return "mock";
}

/**
 * Total PnL: when futures are live, it is the live unrealized PnL plus realized
 * PnL ONLY if realized is genuinely live (no ledger endpoint is implemented in this
 * CR, so callers pass realizedLive=false). Otherwise fall back to the mock total.
 */
export function composeTotalPnl(input: {
  futuresLive: boolean;
  futuresUnrealizedPnl: string;
  realizedLive: boolean;
  realizedPnl: number;
  mockTotalPnl: number;
}): number {
  if (!input.futuresLive) return input.mockTotalPnl;
  return num(input.futuresUnrealizedPnl) + (input.realizedLive ? input.realizedPnl : 0);
}
