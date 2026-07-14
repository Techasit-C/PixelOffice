// Buy-and-hold benchmark — identical cost model and evaluation boundaries as the
// strategy: enters at the first tradable bar's open, exits at the final tradable
// bar's close, forced-liquidated the same way as an END_OF_TEST strategy position.
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { D8, toFixedString } from "./decimal";
import { askPrice, computeExit } from "./fills";
import { sizeWithinCashAndRisk } from "./sizing";
import { computeMetrics } from "./metrics";
import type { BenchmarkResult, EquityPoint, TradeLedgerEntry } from "./types";

export function runBenchmark(
  tradableCandles: Candle[],
  spreadBps: number,
  slippageBps: number,
  feeRate: Prisma.Decimal,
  initialBalance: Prisma.Decimal,
  primaryDurationMs: number,
): BenchmarkResult {
  const firstBar = tradableCandles[0];
  const finalBar = tradableCandles[tradableCandles.length - 1];

  const entryExecutionPrice = askPrice(firstBar.open, spreadBps, slippageBps);
  const initialQuantity = initialBalance
    .dividedBy(entryExecutionPrice.times(feeRate.plus(1)))
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);

  const sizing = sizeWithinCashAndRisk(initialQuantity, entryExecutionPrice, feeRate, initialBalance, null, null);
  if (!sizing.ok) {
    // Structurally unreachable at the configured $100 minimum balance bound — defensive.
    throw new Error(`Benchmark sizing failed unexpectedly: ${sizing.reason}`);
  }
  const quantity = sizing.quantity;
  const residualCash = D8(initialBalance.minus(sizing.entryCost));

  const equityCurve: EquityPoint[] = tradableCandles.map((bar) => ({
    time: bar.openTime + primaryDurationMs,
    equity: toFixedString(D8(residualCash.plus(quantity.times(bar.close)))),
  }));

  const { exitExecutionPrice, exitNotional, exitFee, exitProceeds, realizedPnl } = computeExit(
    finalBar.close, spreadBps, slippageBps, feeRate, quantity, sizing.entryCost,
  );
  const finalCash = D8(residualCash.plus(exitProceeds));
  equityCurve[equityCurve.length - 1] = { time: finalBar.openTime + primaryDurationMs, equity: toFixedString(finalCash) };

  const trade: TradeLedgerEntry = {
    entryTime: firstBar.openTime,
    entryPrice: toFixedString(entryExecutionPrice),
    quantity: toFixedString(quantity),
    entryNotional: toFixedString(sizing.entryNotional),
    entryFee: toFixedString(sizing.entryFee),
    entryCost: toFixedString(sizing.entryCost),
    exitTime: finalBar.openTime + primaryDurationMs,
    exitPrice: toFixedString(exitExecutionPrice),
    exitReason: "END_OF_TEST",
    exitNotional: toFixedString(exitNotional),
    exitFee: toFixedString(exitFee),
    exitProceeds: toFixedString(exitProceeds),
    realizedPnl: toFixedString(realizedPnl),
    intendedRiskBudget: "0.00000000",
    actualNetRisk: "0.00000000",
    actualRiskFraction: 0,
    cashCapped: false,
    netRiskReward: 0,
    warnings: ["Synthetic end-of-test liquidation — not a real market exit."],
  };

  return {
    entryTime: trade.entryTime,
    entryPrice: trade.entryPrice,
    quantity: trade.quantity,
    exitTime: trade.exitTime,
    exitPrice: trade.exitPrice,
    finalCash: toFixedString(finalCash),
    metrics: computeMetrics(equityCurve, [trade], initialBalance),
    equityCurve,
  };
}
