// Pure setup detection: turn a candle series into an indicator snapshot and, from
// that, a raw directional CANDIDATE (or null when there is no bias at all).
//
// This module DECIDES NOTHING about whether to emit a signal — it only measures and
// proposes. The risk gate (risk-gate.ts) is the sole authority that approves or
// downgrades a candidate to WAIT. No I/O, no randomness, fully deterministic.
import type { Candle } from "@/lib/market-data/candles";
import type { PriceLevel, SignalDirection } from "./types";
import { INDICATOR_PERIODS } from "./config";
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

  // --- Structural stop + target ----------------------------------------------
  let stopLoss: number | null = null;
  let primaryTarget: number | null = null;
  const takeProfit: PriceLevel[] = [];

  if (direction === "LONG") {
    if (ind.swingLow !== null && ind.swingLow < entryMid) {
      stopLoss = ind.swingLow - stopBuffer;
      reasoning.push(`Stop below recent swing low ${ind.swingLow.toFixed(2)} (structure).`);
    } else {
      reasoning.push("No swing low below price — no structural stop; setup cannot be sized.");
    }
    if (ind.swingHigh !== null && ind.swingHigh > entryMid) {
      primaryTarget = ind.swingHigh;
      takeProfit.push({ price: ind.swingHigh, label: "Swing-high resistance" });
    } else {
      reasoning.push("No swing high above price — no structural target above entry.");
    }
  } else {
    if (ind.swingHigh !== null && ind.swingHigh > entryMid) {
      stopLoss = ind.swingHigh + stopBuffer;
      reasoning.push(`Stop above recent swing high ${ind.swingHigh.toFixed(2)} (structure).`);
    } else {
      reasoning.push("No swing high above price — no structural stop; setup cannot be sized.");
    }
    if (ind.swingLow !== null && ind.swingLow < entryMid) {
      primaryTarget = ind.swingLow;
      takeProfit.push({ price: ind.swingLow, label: "Swing-low support" });
    } else {
      reasoning.push("No swing low below price — no structural target below entry.");
    }
  }

  // --- Risk:reward from structure --------------------------------------------
  let riskRewardRatio: number | null = null;
  if (stopLoss !== null && primaryTarget !== null) {
    const risk = direction === "LONG" ? entryMid - stopLoss : stopLoss - entryMid;
    const reward = direction === "LONG" ? primaryTarget - entryMid : entryMid - primaryTarget;
    if (risk > 0 && reward > 0) {
      riskRewardRatio = reward / risk;
      // Second, extended target: a 1.618 projection of the measured move. Labelled
      // as a projection so it is never mistaken for a structural level.
      const ext =
        direction === "LONG"
          ? entryMid + reward * 1.618
          : entryMid - reward * 1.618;
      takeProfit.push({ price: ext, label: "1.618 measured-move extension" });
      if (riskRewardRatio >= 2) confidence += 10;
      else if (riskRewardRatio >= 1.5) confidence += 5;
      reasoning.push(
        `Structural R:R ≈ ${riskRewardRatio.toFixed(2)} (risk ${risk.toFixed(2)} vs reward ${reward.toFixed(2)}).`,
      );
    } else {
      reasoning.push("Degenerate risk/reward geometry (non-positive risk or reward).");
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
    confidence,
    reasoning,
    qualityOk,
  };
}
