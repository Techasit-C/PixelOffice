// Pure setup detection: turn a candle series into an indicator snapshot and, from
// that, a raw directional CANDIDATE (or null when there is no bias at all).
//
// This module DECIDES NOTHING about whether to emit a signal — it only measures and
// proposes. The risk gate (risk-gate.ts) is the sole authority that approves or
// downgrades a candidate to WAIT. No I/O, no randomness, fully deterministic.
import type { Candle } from "@/lib/market-data/candles";
import type { PriceLevel, SignalDirection } from "./types";
import {
  ATR_STOP_MULT,
  INDICATOR_PERIODS,
  MAX_STOP_DISTANCE_FRAC,
  MIN_RR,
  TP1_R_MULT,
  TP2_R_MULT,
} from "./config";
import {
  atr as calcAtr,
  closes,
  ema,
  rsi as calcRsi,
  sma,
  swingHigh,
  swingLow,
  volumeAverage,
} from "./indicators";

export interface Indicators {
  lastClose: number | null;
  smaFast: number | null;
  smaSlow: number | null;
  emaFast: number | null;
  emaSlow: number | null;
  rsi: number | null;
  atr: number | null;
  volumeAvg: number | null;
  lastVolume: number | null;
  swingHigh: number | null;
  swingLow: number | null;
}

export interface RawSetup {
  direction: Exclude<SignalDirection, "WAIT">; // "LONG" | "SHORT"
  entryZone: { low: number; high: number };
  stopLoss: number | null;
  takeProfit: PriceLevel[];
  primaryTarget: number | null;
  riskRewardRatio: number | null;
  /** Poor/actual R:R observed at the current entry (may be below MIN_RR). null when
   *  no structural target existed to measure. Diagnostic only. */
  observedRiskReward: number | null;
  /** When WAIT is forced by a poor R:R, a tighter pullback/retest entry zone toward
   *  structure. Analysis suggestion only, never an order. null otherwise. */
  suggestedEntry: { low: number; high: number } | null;
  confidence: number; // 0..100
  reasoning: string[];
  qualityOk: boolean;
}

const P = INDICATOR_PERIODS;

/** Compute every indicator the engine needs from a candle series. Pure. */
export function computeIndicators(candles: Candle[]): Indicators {
  const c = closes(candles);
  const last = candles.length > 0 ? candles[candles.length - 1] : null;
  return {
    lastClose: last ? last.close : null,
    smaFast: sma(c, P.smaFast),
    smaSlow: sma(c, P.smaSlow),
    emaFast: ema(c, P.emaFast),
    emaSlow: ema(c, P.emaSlow),
    rsi: calcRsi(c, P.rsi),
    atr: calcAtr(candles, P.atr),
    volumeAvg: volumeAverage(candles, P.volumeAvg),
    lastVolume: last ? last.volume : null,
    swingHigh: swingHigh(candles, P.swingLookback),
    swingLow: swingLow(candles, P.swingLookback),
  };
}

// A small absolute buffer/zone width when ATR is unavailable: fractions of price.
function priceUnit(ind: Indicators): number {
  const px = ind.lastClose ?? 0;
  if (ind.atr && ind.atr > 0) return ind.atr;
  return Math.abs(px) * 0.005 || 1; // 0.5% of price as an ATR proxy
}

/**
 * Propose a raw candidate from the indicator snapshot, or null when the fast/slow
 * trend MAs are equal (genuinely no directional edge) or core inputs are missing.
 * Confidence, RR, stop and targets are all filled honestly — including null when a
 * structural level is absent, which the gate then rejects.
 */
export function detectSetup(ind: Indicators): RawSetup | null {
  const { lastClose, smaFast, smaSlow, rsi, atr, volumeAvg, lastVolume } = ind;
  if (lastClose === null || smaFast === null || smaSlow === null) return null;
  if (smaFast === smaSlow) return null; // dead flat — no bias to propose

  const direction: RawSetup["direction"] = smaFast > smaSlow ? "LONG" : "SHORT";
  const unit = priceUnit(ind);
  const zoneHalf = unit * 0.15;
  const stopBuffer = unit * 0.1;

  const entryMid = lastClose;
  const entryZone = { low: entryMid - zoneHalf, high: entryMid + zoneHalf };

  const reasoning: string[] = [];
  const trendGap = Math.abs(smaFast - smaSlow) / smaSlow;

  // --- Trend alignment (structure) -------------------------------------------
  // Trend is "aligned" when the fast SMA leads the slow SMA by a meaningful gap AND
  // price is on the trend side of the slow SMA. Using the SLOW SMA for the price
  // filter (not the fast) keeps a healthy pullback-in-trend qualified rather than
  // disqualifying every dip toward the fast MA.
  let aligned = false;
  if (direction === "LONG") {
    aligned = smaFast > smaSlow && lastClose > smaSlow && trendGap > 0.002;
    reasoning.push(
      aligned
        ? `Uptrend: fast SMA(${P.smaFast}) above slow SMA(${P.smaSlow}) by ${(trendGap * 100).toFixed(2)}% with price above the slow SMA.`
        : `Weak/unclear uptrend: fast vs slow SMA gap only ${(trendGap * 100).toFixed(2)}% or price below the slow SMA.`,
    );
  } else {
    aligned = smaFast < smaSlow && lastClose < smaSlow && trendGap > 0.002;
    reasoning.push(
      aligned
        ? `Downtrend: fast SMA(${P.smaFast}) below slow SMA(${P.smaSlow}) by ${(trendGap * 100).toFixed(2)}% with price below the slow SMA.`
        : `Weak/unclear downtrend: fast vs slow SMA gap only ${(trendGap * 100).toFixed(2)}% or price above the slow SMA.`,
    );
  }

  // --- Confidence scoring (0..100), honest and additive ----------------------
  let confidence = 40;
  if (aligned) confidence += 20;

  if (rsi !== null) {
    if (direction === "LONG") {
      if (rsi > 52 && rsi < 72) {
        confidence += 15;
        reasoning.push(`RSI(${P.rsi}) ${rsi.toFixed(1)} — momentum supports longs, not yet overbought.`);
      } else if (rsi >= 72) {
        confidence -= 10;
        reasoning.push(`RSI(${P.rsi}) ${rsi.toFixed(1)} — overbought; chasing risk.`);
      } else {
        reasoning.push(`RSI(${P.rsi}) ${rsi.toFixed(1)} — momentum neutral/soft for longs.`);
      }
    } else {
      if (rsi < 48 && rsi > 28) {
        confidence += 15;
        reasoning.push(`RSI(${P.rsi}) ${rsi.toFixed(1)} — momentum supports shorts, not yet oversold.`);
      } else if (rsi <= 28) {
        confidence -= 10;
        reasoning.push(`RSI(${P.rsi}) ${rsi.toFixed(1)} — oversold; chasing risk.`);
      } else {
        reasoning.push(`RSI(${P.rsi}) ${rsi.toFixed(1)} — momentum neutral/soft for shorts.`);
      }
    }
  }

  if (volumeAvg !== null && lastVolume !== null) {
    if (lastVolume > volumeAvg) {
      confidence += 15;
      reasoning.push(`Volume above ${P.volumeAvg}-bar average — participation confirms the move.`);
    } else {
      confidence += 5;
      reasoning.push(`Volume below ${P.volumeAvg}-bar average — weaker participation.`);
    }
  }

  if (atr === null) {
    reasoning.push("ATR unavailable — volatility-scaled stop uses a price-fraction proxy.");
  }

  // --- Stop-loss: structure first, ATR-based fallback ------------------------
  // Prefer a real structural level. When none exists but ATR is available, fall back
  // to a volatility-scaled stop so a valid trend is still sizeable. When NEITHER is
  // available, stop stays null and the gate VETOes — that WAIT path is intentional.
  let stopLoss: number | null = null;

  if (direction === "LONG") {
    if (ind.swingLow !== null && ind.swingLow < entryMid) {
      stopLoss = ind.swingLow - stopBuffer;
      reasoning.push(`Stop below swing low ${ind.swingLow.toFixed(2)} − buffer (structural).`);
    } else if (atr !== null && atr > 0) {
      stopLoss = entryMid - ATR_STOP_MULT * atr;
      reasoning.push(
        `ATR-based stop at ${ATR_STOP_MULT}×ATR (${(ATR_STOP_MULT * atr).toFixed(2)}) below entry — no valid swing low.`,
      );
    } else {
      reasoning.push("No swing low below price and ATR unavailable — no stop; setup cannot be sized.");
    }
  } else {
    if (ind.swingHigh !== null && ind.swingHigh > entryMid) {
      stopLoss = ind.swingHigh + stopBuffer;
      reasoning.push(`Stop above swing high ${ind.swingHigh.toFixed(2)} + buffer (structural).`);
    } else if (atr !== null && atr > 0) {
      stopLoss = entryMid + ATR_STOP_MULT * atr;
      reasoning.push(
        `ATR-based stop at ${ATR_STOP_MULT}×ATR (${(ATR_STOP_MULT * atr).toFixed(2)}) above entry — no valid swing high.`,
      );
    } else {
      reasoning.push("No swing high above price and ATR unavailable — no stop; setup cannot be sized.");
    }
  }

  // --- Target + R:R: structure first; on poor R:R, TRY a risk-multiple fallback -----
  // Order of preference:
  //   1. Structural target whose honest R:R meets MIN_RR -> trade it (as before).
  //   2. Structural target too close (or none) BUT the stop is "tight enough" and the
  //      risk-multiple TP is a valid positive price -> adopt the risk-multiple TP.
  //   3. Otherwise -> leave target/R:R null (gate WAITs), record the poor observed R:R
  //      and a tighter pullback/retest entry zone toward structure.
  let primaryTarget: number | null = null;
  let riskRewardRatio: number | null = null;
  let observedRiskReward: number | null = null;
  let suggestedEntry: { low: number; high: number } | null = null;
  const takeProfit: PriceLevel[] = [];

  if (stopLoss !== null) {
    const risk = direction === "LONG" ? entryMid - stopLoss : stopLoss - entryMid;
    if (risk > 0) {
      // A structural target is the swing level in the direction of the trade, but only
      // if it sits beyond entry (otherwise it is not a target).
      const structTarget =
        direction === "LONG"
          ? ind.swingHigh !== null && ind.swingHigh > entryMid
            ? ind.swingHigh
            : null
          : ind.swingLow !== null && ind.swingLow < entryMid
            ? ind.swingLow
            : null;

      // Observed structural R:R (may be poor). Recorded as a diagnostic even when we do
      // NOT trade the structural target.
      let structRR: number | null = null;
      if (structTarget !== null) {
        const structReward =
          direction === "LONG" ? structTarget - entryMid : entryMid - structTarget;
        structRR = structReward / risk;
        observedRiskReward = structRR;
      }

      if (structTarget !== null && structRR !== null && structRR >= MIN_RR) {
        // STRUCTURE-FIRST (actionable): honest R:R from the real level meets the floor.
        primaryTarget = structTarget;
        const reward = direction === "LONG" ? structTarget - entryMid : entryMid - structTarget;
        riskRewardRatio = structRR;
        takeProfit.push({
          price: structTarget,
          label: `TP1 · ${direction === "LONG" ? "swing-high resistance" : "swing-low support"} (structural, R:R ${riskRewardRatio.toFixed(2)})`,
        });
        // TP2: 1.618 measured-move projection beyond the structural target.
        const tp2 =
          direction === "LONG" ? entryMid + reward * 1.618 : entryMid - reward * 1.618;
        takeProfit.push({ price: tp2, label: "TP2 · 1.618 measured-move extension" });
        reasoning.push(
          `Structural R:R ≈ ${riskRewardRatio.toFixed(2)} (risk ${risk.toFixed(2)} vs reward ${reward.toFixed(2)}).`,
        );
      } else {
        // Structural target is absent OR too close (poor R:R). Before giving up, TRY a
        // risk-multiple TP — adopt it only when the stop is "tight enough" AND the target
        // is a valid, positive price. Never stretch a TP to rescue a far-from-structure
        // entry: that path WAITs and suggests a pullback instead.
        const stopDistanceFrac = risk / entryMid;
        const fallbackTP1 =
          direction === "LONG" ? entryMid + TP1_R_MULT * risk : entryMid - TP1_R_MULT * risk;
        const fallbackTP2 =
          direction === "LONG" ? entryMid + TP2_R_MULT * risk : entryMid - TP2_R_MULT * risk;
        const tightEnough = stopDistanceFrac <= MAX_STOP_DISTANCE_FRAC;
        // LONG fallback is inherently a positive price above entry; SHORT must stay > 0.
        const targetPositive = direction === "LONG" ? true : fallbackTP2 > 0;

        if (tightEnough && targetPositive) {
          primaryTarget = fallbackTP1;
          riskRewardRatio = TP1_R_MULT;
          if (structTarget !== null) {
            takeProfit.push({
              price: fallbackTP1,
              label: `TP1 · ${TP1_R_MULT}R (risk-multiple, structural target too close)`,
            });
            takeProfit.push({
              price: fallbackTP2,
              label: `TP2 · ${TP2_R_MULT}R (risk-multiple, structural target too close)`,
            });
            reasoning.push(
              `Structural target too close (observed R:R ≈ ${structRR!.toFixed(2)} < ${MIN_RR.toFixed(2)}) but stop is tight (${(stopDistanceFrac * 100).toFixed(1)}% of entry ≤ ${(MAX_STOP_DISTANCE_FRAC * 100).toFixed(0)}% cap) — using a risk-multiple TP1 at ${TP1_R_MULT}R, TP2 at ${TP2_R_MULT}R (risk ${risk.toFixed(2)}).`,
            );
          } else {
            takeProfit.push({ price: fallbackTP1, label: `TP1 · ${TP1_R_MULT}R (measured, ATR-based)` });
            takeProfit.push({ price: fallbackTP2, label: `TP2 · ${TP2_R_MULT}R (measured, ATR-based)` });
            reasoning.push(
              `No usable structural target — measured TP1 at ${TP1_R_MULT}R, TP2 at ${TP2_R_MULT}R (risk ${risk.toFixed(2)}).`,
            );
          }
        } else {
          // Fallback NOT adopted: leave target/R:R null so the gate WAITs. Record the poor
          // observed R:R and suggest a tighter pullback/retest entry near structure.
          if (observedRiskReward === null) observedRiskReward = TP1_R_MULT; // rejected fallback R:R
          if (direction === "LONG") {
            if (ind.swingLow !== null && ind.swingLow < entryMid) {
              const sl = ind.swingLow;
              suggestedEntry = { low: sl, high: sl + stopBuffer + (entryMid - sl) * 0.25 };
            } else {
              suggestedEntry = { low: entryMid - 2 * unit, high: entryMid - unit };
            }
          } else {
            if (ind.swingHigh !== null && ind.swingHigh > entryMid) {
              const sh = ind.swingHigh;
              suggestedEntry = { low: sh - stopBuffer - (sh - entryMid) * 0.25, high: sh };
            } else {
              suggestedEntry = { low: entryMid + unit, high: entryMid + 2 * unit };
            }
          }
          const sideWord = direction === "LONG" ? "support" : "resistance";
          const rrText =
            structRR !== null
              ? `Structural R:R ≈ ${structRR.toFixed(2)} below required ${MIN_RR.toFixed(2)}`
              : `No structural target and the risk-multiple TP was rejected`;
          const capText = !tightEnough
            ? ` and entry is ${(stopDistanceFrac * 100).toFixed(0)}% from stop (> ${(MAX_STOP_DISTANCE_FRAC * 100).toFixed(0)}% cap)`
            : ` and the risk-multiple target would be a non-positive price`;
          reasoning.push(
            `${rrText}${capText}: risk/reward not acceptable yet — wait for a pullback toward [${suggestedEntry.low.toFixed(2)}–${suggestedEntry.high.toFixed(2)}] near ${sideWord} for a tighter stop.`,
          );
        }
      }

      if (riskRewardRatio !== null) {
        if (riskRewardRatio >= 2) confidence += 10;
        else if (riskRewardRatio >= 1.5) confidence += 5;
      }
    } else {
      reasoning.push("Degenerate risk (non-positive) — target left null; setup cannot be sized.");
    }
  }

  confidence = Math.max(0, Math.min(100, confidence));

  const qualityOk =
    aligned && stopLoss !== null && primaryTarget !== null && riskRewardRatio !== null;

  return {
    direction,
    entryZone,
    stopLoss,
    takeProfit,
    primaryTarget,
    riskRewardRatio,
    observedRiskReward,
    suggestedEntry,
    confidence,
    reasoning,
    qualityOk,
  };
}
