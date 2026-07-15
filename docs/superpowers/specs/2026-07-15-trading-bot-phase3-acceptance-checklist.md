# AI Trading Bot — Phase 3 Acceptance Checklist

**Status: Accepted (2026-07-16).** All automated gates pass, and the authenticated
interactive acceptance checklist below was completed by the repository owner — all
items passed.

## How to run this checklist

```bash
cd pixel-office
npm run dev
```

Open `http://localhost:3000/trading-bot/backtest` signed in, DevTools Console open.

## Checklist

### 1. Authenticated access
Visit signed out — redirected/401. Sign in — page renders, no console errors.

### 2. Navigation between Trading Bot and Backtest
From `/trading-bot`, use the visible "Open Backtesting" link to reach
`/trading-bot/backtest` — no manual URL entry. From there, use the visible "Back to
Trading Bot" link to return. Both are keyboard-reachable with clear accessible labels.

### 3. A real MEXC-backed run completes and returns a coherent result
Run BTC/USDT over a 90-day range with defaults. Confirm: requested/fetched-warmup/
actual-evaluation ranges are all shown and distinct; candle counts are non-zero; the
metrics block and equity curve render; the buy-and-hold comparison is present.

### 4. Immutable result/config binding
Confirm the "Results for" summary (symbol, normalized UTC range, initial balance, fee
rate, spread, slippage) matches the configuration the server actually used — sourced
from the server response, not the live form.

### 5. Stale-result clearing after input changes
After a successful run, change any configuration field. Confirm Metrics, Equity Curve,
Trade Ledger, and the CSV export control are all hidden immediately, replaced by an
"Inputs changed — run the backtest again" message.

### 6. Client-side validation without unnecessary API requests
Leave the date range empty, or enter an out-of-bounds value (e.g. initial balance
below 100), and click Run. Confirm no network request is issued, the first invalid
field is focused, and its error message is associated via `aria-describedby`.

### 7. Hand-verify one trade from the ledger
Pick one closed trade; manually recompute its `realizedPnl` from `entryPrice`,
`exitPrice`, `quantity`, and the configured fee/spread/slippage using the formulas in
the design spec §8.4; confirm it matches the ledger row.

### 8. CSV export
Click "Download CSV"; confirm the file opens in a spreadsheet with one row per trade
and the header matches the ledger's fields. Confirm no equity-curve CSV is offered
anywhere on the page. Confirm a trade with a negative `realizedPnl` opens as a normal
negative number (schema-aware export: monetary/quantity/timestamp columns stay
numeric; only genuine free-text columns are formula-injection-protected).

### 9. Cancel behavior matches the documented, non-overclaiming copy, and leaves no stale result
Start a run, click Cancel promptly. Confirm the UI shows the exact cancellation copy
from `BacktestPageClient.tsx` (network-phase-only, not "stops all server work"), and
that no prior result remains visible.

### 10. Oversized/invalid input is rejected cleanly
Try a >365-day range, an out-of-bounds initial balance, and an unsupported symbol
(via direct API call). Confirm each returns 400 with a clear message, not a crash.

### 11. Browser console stays clean
No uncaught exceptions or React errors throughout items 1–10.

### 12. No execution/broker capability is reachable
Confirm nothing on this page places, cancels, or references a real order — this is a
read-only historical simulation.

## Result

**Passed (2026-07-16).** All items completed by the repository owner; Phase 3 is
marked Accepted.
