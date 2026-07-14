// Deterministic, template-generated plain-language explanations. NO LLM, no
// free-text generation — every phrase is chosen from a small fixed set based
// on actual computed diagnostic state. Must never invent a market fact or
// imply certainty of profit; confidence is always described as a heuristic.
import type { SignalDirection } from "./types";
import type { MacdResult } from "./macd";
import type { BollingerResult } from "./bollinger";
import type { MultiTimeframeResult } from "./multi-timeframe";

function macdPhrase(macd: MacdResult): string {
  if (macd.macdLine === null || macd.signalLine === null) return "MACD unavailable";
  return macd.macdLine > macd.signalLine ? "MACD bullish" : "MACD bearish";
}

function bollingerPhrase(bb: BollingerResult): string {
  if (bb.percentB === null) return "Bollinger unavailable";
  if (bb.percentB < 0.2) return "near lower Bollinger Band";
  if (bb.percentB > 0.8) return "near upper Bollinger Band";
  return "within Bollinger mid-range";
}

function timeframePhrase(confirmation: MultiTimeframeResult | null): string {
  if (!confirmation) return "timeframe confirmation unavailable";
  return `1h ${confirmation.oneHour.toLowerCase()}, 1d ${confirmation.oneDay.toLowerCase()}`;
}

function actionWord(direction: SignalDirection): "Buy" | "Sell" | "Hold" {
  if (direction === "LONG") return "Buy";
  if (direction === "SHORT") return "Sell";
  return "Hold";
}

export function buildPlainLanguageSummary(
  direction: SignalDirection,
  entryZone: { low: number; high: number } | null,
  stopLoss: number | null,
  macd: MacdResult,
  bollinger: BollingerResult,
  confirmation: MultiTimeframeResult | null,
): string {
  const action = actionWord(direction);
  if (direction === "WAIT" || entryZone === null || stopLoss === null) {
    return "Hold — no actionable setup right now.";
  }
  const entryMid = ((entryZone.low + entryZone.high) / 2).toFixed(2);
  return (
    `${action} — ${macdPhrase(macd)}, ${bollingerPhrase(bollinger)}, ${timeframePhrase(confirmation)}. ` +
    `Entry near ${entryMid}, stop at ${stopLoss.toFixed(2)}. ` +
    "Confidence is a heuristic score, not a probability of profit."
  );
}
