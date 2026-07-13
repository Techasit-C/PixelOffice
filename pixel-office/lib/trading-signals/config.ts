// Static configuration for the analysis-only signal engine.
//
// Deterministic knobs only — no secrets, no per-user state, no live-trading params.
// The whitelist here is also the public-candle symbol map: analysis is limited to a
// tiny, well-known set of liquid pairs so we never guess an unknown symbol.
import type { Timeframe } from "./types";

/**
 * The ONLY symbols the engine will analyse, mapped to the keyless public-klines
 * ticker used by the candle provider. Anything not in this map is rejected up front
 * (no fabricated data for unknown symbols).
 */
export const SYMBOL_WHITELIST: Record<string, string> = {
  "BTC/USDT": "BTCUSDT",
  "ETH/USDT": "ETHUSDT",
  "SOL/USDT": "SOLUSDT",
};

/** Canonical list of analysable symbols (whitelist keys). */
export const SUPPORTED_SYMBOLS = Object.keys(SYMBOL_WHITELIST);

export const DEFAULT_TIMEFRAME: Timeframe = "4h";

// --- Indicator periods (bars) -------------------------------------------------
export const INDICATOR_PERIODS = {
  smaFast: 20,
  smaSlow: 50,
  emaFast: 12,
  emaSlow: 26,
  rsi: 14,
  atr: 14,
  volumeAvg: 20,
  /** Look-back window each side when scanning for swing highs/lows (S/R). */
  swingLookback: 3,
} as const;

// --- Volatility-fallback knobs (deterministic; no live-trading params) --------
/** ATR-multiple distance for the volatility-based stop fallback. */
export const ATR_STOP_MULT = 1.5;
/** Risk multiples for take-profit levels when no structural target is usable. */
export const TP1_R_MULT = 1.5;
export const TP2_R_MULT = 2.5;

// --- Risk floors (HARD gates — reject when inputs missing) --------------------
/** Minimum reward-to-risk. A setup below this is downgraded to WAIT. */
export const MIN_RR = 1.5;
/** Minimum confidence (0..100) to emit a directional signal. */
export const MIN_CONFIDENCE = 55;
/** Minimum candles required before ANY analysis is attempted. */
export const MIN_BARS = 60;

// --- INERT position-sizing placeholders (NOT live-enforced in v1) -------------
// These exist to document the eventual risk envelope ONLY. v1 is analysis-only and
// executes nothing, so none of these are wired to any order path. They intentionally
// default to the most conservative value so that if a future caller ever reads them
// with inputs missing, the safe outcome is to REJECT rather than to size a trade.
//
// ⚠️ Do NOT interpret these as active limits — there is no trading code to limit.
export const MAX_RISK_PER_TRADE = 0; // fraction of equity; 0 => reject/size-nothing
export const MAX_DAILY_LOSS = 0; // placeholder; not evaluated in v1
export const MAX_OPEN_POSITIONS = 0; // placeholder; not evaluated in v1

/** Number of candles to request from the public provider per analysis. */
export const CANDLE_LIMIT = 200;
