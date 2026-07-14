// Pure metric functions. Callable on any equity-curve/trade-ledger prefix (used by the
// future-independence tests). Statistical math uses plain `number` (not Decimal) —
// rounding happens only at serialization.
import { Prisma } from "@prisma/client";
import { D8, toFixedString } from "./decimal";
import type { BacktestMetrics, EquityPoint, TradeLedgerEntry } from "./types";

const ANNUALIZATION_FACTOR = Math.sqrt(365.25 * 6); // 4h bars/year

export function computeMetrics(
  equityCurve: EquityPoint[],
  trades: TradeLedgerEntry[],
  initialBalance: Prisma.Decimal,
): BacktestMetrics {
  const finalEquity = new Prisma.Decimal(equityCurve[equityCurve.length - 1]?.equity ?? initialBalance.toString());
  const netProfit = D8(finalEquity.minus(initialBalance));
  const totalReturn = netProfit.dividedBy(initialBalance).toNumber();

  const pnls = trades.map((t) => new Prisma.Decimal(t.realizedPnl));
  const wins = pnls.filter((p) => p.greaterThan(0));
  const losses = pnls.filter((p) => p.lessThan(0));
  const total = trades.length;
  const winRate = total > 0 ? wins.length / total : 0;
  const lossRate = total > 0 ? losses.length / total : 0;

  const grossProfit = wins.reduce((a, b) => a.plus(b), new Prisma.Decimal(0));
  const grossLoss = losses.reduce((a, b) => a.plus(b.abs()), new Prisma.Decimal(0)); // positive magnitude
  const profitFactor = grossLoss.isZero() ? null : grossProfit.dividedBy(grossLoss).toNumber();
  const profitFactorReason = grossLoss.isZero() ? "undefined — no losing trades in this run" : null;

  const averageWin = wins.length > 0 ? D8(grossProfit.dividedBy(wins.length)) : new Prisma.Decimal(0);
  const averageLoss = losses.length > 0 ? D8(grossLoss.dividedBy(losses.length)) : new Prisma.Decimal(0);

  const expectancy = D8(
    new Prisma.Decimal(winRate).times(averageWin).minus(new Prisma.Decimal(lossRate).times(averageLoss)),
  );

  let peak = new Prisma.Decimal(equityCurve[0]?.equity ?? initialBalance.toString());
  let maxDrawdownPct = 0;
  for (const p of equityCurve) {
    const value = new Prisma.Decimal(p.equity);
    if (value.greaterThan(peak)) peak = value;
    if (peak.greaterThan(0)) {
      const drawdown = peak.minus(value).dividedBy(peak).toNumber();
      if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
    }
  }

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = new Prisma.Decimal(equityCurve[i - 1].equity);
    const curr = new Prisma.Decimal(equityCurve[i].equity);
    if (prev.isZero()) continue;
    returns.push(curr.dividedBy(prev).minus(1).toNumber());
  }
  let sharpe: number | null = null;
  if (returns.length >= 2) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const stdev = Math.sqrt(variance);
    if (stdev > 0) sharpe = (mean / stdev) * ANNUALIZATION_FACTOR;
  }

  return {
    netProfit: toFixedString(netProfit),
    totalReturn,
    winRate,
    lossRate,
    profitFactor,
    profitFactorReason,
    maxDrawdownPct,
    sharpe,
    tradeCount: total,
    averageWin: toFixedString(averageWin),
    averageLoss: toFixedString(averageLoss),
    expectancy: toFixedString(expectancy),
  };
}
