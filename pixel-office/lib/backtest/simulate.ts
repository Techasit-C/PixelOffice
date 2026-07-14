// The per-bar event loop. Strict order: 1) pending entry at open, 2) gap exit for an
// ALREADY-open position, 3) intrabar stop/TP1, 4) equity mark, 5) signal (decision bars
// only), 6) queue next entry. A missing/delayed next bar expires the pending entry
// (GAP_BEFORE_ENTRY) — it is never deferred to a later, non-contiguous bar. Pure,
// deterministic, no I/O, no wall clock — `signalProvider` is injected so this loop's
// mechanics can be tested independently of the real signal engine.
import { Prisma } from "@prisma/client";
import type { Candle } from "@/lib/market-data/candles";
import { isDecisionBar, isTradableBar, type EvaluationWindow } from "./candle-window";
import { validateAndSizeEntry, detectExitTrigger, gapExitRawMid, computeExit, type EntrySignalLevels } from "./fills";
import { D8, toFixedString } from "./decimal";
import type { TradeLedgerEntry, EquityPoint, UnexecutedSignalRecord, ExecutionEvent, ExitReason } from "./types";

export interface SignalProviderResult {
  direction: "LONG" | "SHORT" | "WAIT";
  entryZone: { low: number; high: number } | null;
  stopLoss: number | null;
  takeProfit1: number | null;
}
export type SignalProvider = (closedPrimaryCandles: Candle[], analysisNow: number) => SignalProviderResult;

export interface SimulateConfig {
  spreadBps: number;
  slippageBps: number;
  feeRate: Prisma.Decimal;
  initialBalance: Prisma.Decimal;
  finalize: boolean;
}

export interface SimulateResult {
  tradeLedger: TradeLedgerEntry[];
  unexecutedSignals: UnexecutedSignalRecord[];
  equityCurve: EquityPoint[];
  events: ExecutionEvent[];
}

interface OpenPosition {
  entryTime: number;
  entryExecutionPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
  entryNotional: Prisma.Decimal;
  entryFee: Prisma.Decimal;
  entryCost: Prisma.Decimal;
  stopLoss: number;
  takeProfit1: number;
  intendedRiskBudget: Prisma.Decimal;
  actualNetRisk: Prisma.Decimal;
  actualRiskFraction: number;
  cashCapped: boolean;
  netRiskReward: number;
}

interface PendingEntry {
  fromBarIndex: number;
  levels: EntrySignalLevels;
}

export function runSimulation(
  primaryCandles: Candle[],
  window: EvaluationWindow,
  primaryDurationMs: number,
  signalProvider: SignalProvider,
  config: SimulateConfig,
): SimulateResult {
  let seq = 0;
  const events: ExecutionEvent[] = [];
  const emit = (type: ExecutionEvent["type"], time: number) => {
    events.push({ type, time, sequenceNumber: seq++ });
  };

  const tradeLedger: TradeLedgerEntry[] = [];
  const unexecutedSignals: UnexecutedSignalRecord[] = [];
  const equityCurve: EquityPoint[] = [{ time: window.normalizedStart, equity: toFixedString(config.initialBalance) }];

  let cash = config.initialBalance;
  let openPosition: OpenPosition | null = null;
  let pendingEntry: PendingEntry | null = null;

  function closePosition(reason: ExitReason, rawMid: number, exitTime: number, extraWarning?: string) {
    if (!openPosition) return;
    const { exitExecutionPrice, exitNotional, exitFee, exitProceeds, realizedPnl } = computeExit(
      rawMid, config.spreadBps, config.slippageBps, config.feeRate, openPosition.quantity, openPosition.entryCost,
    );
    cash = D8(cash.plus(exitProceeds));
    tradeLedger.push({
      entryTime: openPosition.entryTime,
      entryPrice: toFixedString(openPosition.entryExecutionPrice),
      quantity: toFixedString(openPosition.quantity),
      entryNotional: toFixedString(openPosition.entryNotional),
      entryFee: toFixedString(openPosition.entryFee),
      entryCost: toFixedString(openPosition.entryCost),
      exitTime,
      exitPrice: toFixedString(exitExecutionPrice),
      exitReason: reason,
      exitNotional: toFixedString(exitNotional),
      exitFee: toFixedString(exitFee),
      exitProceeds: toFixedString(exitProceeds),
      realizedPnl: toFixedString(realizedPnl),
      intendedRiskBudget: toFixedString(openPosition.intendedRiskBudget),
      actualNetRisk: toFixedString(openPosition.actualNetRisk),
      actualRiskFraction: openPosition.actualRiskFraction,
      cashCapped: openPosition.cashCapped,
      netRiskReward: openPosition.netRiskReward,
      warnings: extraWarning ? [extraWarning] : [],
    });
    if (reason === "END_OF_TEST") {
      // Replace, not duplicate, the final equity-curve point.
      equityCurve[equityCurve.length - 1] = { time: exitTime, equity: toFixedString(cash) };
    }
    openPosition = null;
  }

  for (let i = 0; i < primaryCandles.length; i++) {
    const bar = primaryCandles[i];
    const barCloseTime = bar.openTime + primaryDurationMs;
    const tradable = isTradableBar(bar.openTime, barCloseTime, window);
    const decision = isDecisionBar(barCloseTime, window);

    if (tradable) {
      // Step 1: process any pending entry at this bar's open.
      if (pendingEntry && pendingEntry.fromBarIndex === i - 1) {
        const prevBar = primaryCandles[i - 1];
        const contiguous = bar.openTime === prevBar.openTime + primaryDurationMs;
        const signalCloseTime = prevBar.openTime + primaryDurationMs;
        if (!contiguous) {
          unexecutedSignals.push({ barCloseTime: signalCloseTime, reason: "GAP_BEFORE_ENTRY" });
        } else {
          const result = validateAndSizeEntry(bar.open, pendingEntry.levels, config.spreadBps, config.slippageBps, config.feeRate, cash);
          emit("ENTRY_PROCESSED", bar.openTime);
          if (result.ok) {
            cash = D8(cash.minus(result.entryCost));
            openPosition = {
              entryTime: bar.openTime,
              entryExecutionPrice: result.entryExecutionPrice,
              quantity: result.quantity,
              entryNotional: result.entryNotional,
              entryFee: result.entryFee,
              entryCost: result.entryCost,
              stopLoss: pendingEntry.levels.stopLoss,
              takeProfit1: pendingEntry.levels.takeProfit1,
              intendedRiskBudget: result.intendedRiskBudget,
              actualNetRisk: result.actualNetRisk,
              actualRiskFraction: result.actualRiskFraction,
              cashCapped: result.cashCapped,
              netRiskReward: result.netRiskReward,
            };
          } else {
            unexecutedSignals.push({ barCloseTime: signalCloseTime, reason: result.reason });
          }
        }
      }
      // A pending entry is consumed (attempted or expired) exactly once, on the very
      // next bar — never deferred to a later bar.
      pendingEntry = null;

      // Step 2: gap exits for a position ALREADY open entering this bar — never for a
      // position this same bar's step 1 just opened.
      const justOpenedThisBar = openPosition !== null && openPosition.entryTime === bar.openTime;
      if (openPosition && !justOpenedThisBar) {
        const gap = gapExitRawMid(bar.open, openPosition.stopLoss, openPosition.takeProfit1);
        emit("GAP_EXIT_PROCESSED", bar.openTime);
        if (gap) closePosition(gap.trigger, gap.rawMid, bar.openTime, "GAP_RESOLVED_OPEN_POSITION");
      }

      // Step 3: intrabar stop/TP1 (applies whether pre-existing or just opened in step 1).
      if (openPosition) {
        const trigger = detectExitTrigger(bar.low, bar.high, openPosition.stopLoss, openPosition.takeProfit1);
        emit("INTRABAR_EXIT_PROCESSED", barCloseTime);
        if (trigger !== "NONE") {
          const rawMid = trigger === "STOP" ? openPosition.stopLoss : openPosition.takeProfit1;
          closePosition(trigger, rawMid, barCloseTime);
        }
      }

      // Step 4: mark equity at this bar's close.
      const equityValue = openPosition ? D8(cash.plus(openPosition.quantity.times(bar.close))) : cash;
      equityCurve.push({ time: barCloseTime, equity: toFixedString(equityValue) });
      emit("EQUITY_MARKED", barCloseTime);
    }

    if (decision) {
      const closedSoFar = primaryCandles.slice(0, i + 1);
      const signal = signalProvider(closedSoFar, barCloseTime);
      emit("SIGNAL_COMPUTED", barCloseTime);
      if (
        signal.direction === "LONG" &&
        !openPosition &&
        signal.entryZone !== null &&
        signal.stopLoss !== null &&
        signal.takeProfit1 !== null
      ) {
        pendingEntry = {
          fromBarIndex: i,
          levels: {
            entryZoneLow: signal.entryZone.low,
            entryZoneHigh: signal.entryZone.high,
            stopLoss: signal.stopLoss,
            takeProfit1: signal.takeProfit1,
          },
        };
      }
    }
  }

  if (config.finalize && openPosition) {
    const finalBar = primaryCandles[primaryCandles.length - 1];
    closePosition("END_OF_TEST", finalBar.close, finalBar.openTime + primaryDurationMs, "Synthetic end-of-test liquidation — not a real market exit.");
  }

  return { tradeLedger, unexecutedSignals, equityCurve, events };
}
