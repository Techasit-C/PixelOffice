// TEMPORARY minimal stub — replaced with the full template-based implementation
// in Task 13. Exists now only so engine.ts compiles for Tasks 9–12.
import type { SignalDirection } from "./types";
import type { MacdResult } from "./macd";
import type { BollingerResult } from "./bollinger";
import type { MultiTimeframeResult } from "./multi-timeframe";

export function buildPlainLanguageSummary(
  _direction: SignalDirection,
  _entryZone: { low: number; high: number } | null,
  _stopLoss: number | null,
  _macd: MacdResult,
  _bollinger: BollingerResult,
  _confirmation: MultiTimeframeResult | null,
): string {
  return "";
}
