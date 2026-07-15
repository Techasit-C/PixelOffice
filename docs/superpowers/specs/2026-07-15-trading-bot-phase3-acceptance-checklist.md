# AI Trading Bot — Phase 3 Acceptance Checklist

Status of the implementation: complete, automated gates passing; authenticated
interactive acceptance by the repository owner is the remaining step before Phase 3 is
marked Accepted.

## How to run this checklist

```bash
cd pixel-office
npm run dev
```

Open `http://localhost:3000/trading-bot/backtest` signed in, DevTools Console open.

## Checklist

### 1. Authenticated access
Visit signed out — redirected/401. Sign in — page renders, no console errors.

### 2. A real MEXC-backed run completes and returns a coherent result
Run BTC/USDT over a 90-day range with defaults. Confirm: requested/fetched-warmup/
actual-evaluation ranges are all shown and distinct; candle counts are non-zero; the
metrics block and equity curve render; the buy-and-hold comparison is present.

### 3. Hand-verify one trade from the ledger
Pick one closed trade; manually recompute its `realizedPnl` from `entryPrice`,
`exitPrice`, `quantity`, and the configured fee/spread/slippage using the formulas in
the design spec §8.4; confirm it matches the ledger row.

### 4. CSV export
Click "Download CSV"; confirm the file opens in a spreadsheet with one row per trade
and the header matches the ledger's fields. Confirm no equity-curve CSV is offered
anywhere on the page. Confirm a trade with a negative `realizedPnl` opens as a
quoted/text-prefixed value rather than being interpreted as a formula.

### 5. Cancel behavior matches the documented, non-overclaiming copy
Start a run, click Cancel promptly. Confirm the UI shows the exact cancellation copy
from `BacktestPageClient.tsx` (network-phase-only, not "stops all server work").

### 6. Oversized/invalid input is rejected cleanly
Try a >365-day range, an out-of-bounds initial balance, and an unsupported symbol
(via direct API call). Confirm each returns 400 with a clear message, not a crash.

### 7. Browser console stays clean
No uncaught exceptions or React errors throughout items 1–6.

### 8. No execution/broker capability is reachable
Confirm nothing on this page places, cancels, or references a real order — this is a
read-only historical simulation.

## Result

Pending — to be completed by the repository owner.
