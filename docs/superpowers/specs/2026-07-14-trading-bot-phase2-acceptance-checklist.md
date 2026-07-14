# AI Trading Bot — Phase 2 Acceptance Checklist

**Status: Accepted (2026-07-14).** All 7 items below were completed by the
repository owner on 2026-07-14 and passed — diagnostic consistency,
heuristic-confidence labeling, SHORT remaining non-executable, the LONG
paper-trading flow, restart reset behavior, and browser-console verification.
No unexpected errors were observed. All automated gates also passed (300/300
tests, clean typecheck, clean lint, clean build, clean static safety scan —
see `docs/superpowers/specs/2026-07-14-trading-bot-phase2-signals-design.md`
and `docs/superpowers/plans/2026-07-14-trading-bot-phase2-signals.md` for the
full verification record).

If a regression is ever found against this accepted checklist in the future,
treat it as a defect: fix only that defect, add an automated regression test
where practical, rerun the full verification suite (`npm test`, `npx tsc
--noEmit`, `npm run lint`, `npm run build`), and re-request acceptance — do
not expand scope or add functionality while fixing a failure.

## How to run this checklist

```bash
cd pixel-office
npm run dev
```

Open `http://localhost:3000/trading-bot` in a browser with DevTools open
(Console tab). Sign in with a Clerk account when prompted.

---

## Checklist

### 1. Authenticated access (unchanged from Phase 1 — re-verify briefly)

**Steps:** Visit `/trading-bot` signed out, then sign in.

**Expected result:** Redirected to sign-in when signed out; page renders
normally after signing in, no console errors.

**Evidence:** Screenshot immediately after sign-in.

### 2. Diagnostics display correctly

**Steps:** Look at each signal row on the Signals card.

**Expected result:** Each signal shows a `plainLanguageSummary` sentence (not
blank), and the confidence label reads **"confidence (heuristic)"** — not
"probability" or "win rate" anywhere on the page.

**Evidence:** Screenshot of at least one signal row showing both the summary
sentence and the "confidence (heuristic)" label.

### 3. MACD/Bollinger/timeframe detail is present and internally consistent

**Steps:** For one `LONG` (or `SHORT`) signal, read its `plainLanguageSummary`
phrases (e.g. "MACD bullish", "near lower Bollinger Band", "1h aligned, 1d
aligned") and the separate "Timeframe confirmation: ..." line beneath it.

**Expected result:** The two lines agree with each other (the summary's
timeframe phrase matches the explicit confirmation line's states/adjustment
sign). Nothing contradicts itself.

**Evidence:** Screenshot showing both lines for the same signal.

### 4. `SHORT` remains non-executable

**Steps:** If a `SHORT` signal appears, inspect it.

**Expected result:** It still shows "SHORT not supported in Phase 1," no
order control is rendered, and there is no way to submit an order for it from
the UI (unchanged from Phase 1 — this checklist item re-confirms Phase 2
didn't regress it).

**Evidence:** Screenshot of a SHORT signal's disabled state, if one appears
during the session (note if none appeared — not a failure, just unobserved).

### 5. BUY flow still works end-to-end

**Steps:** Place a mock order on a `LONG` signal exactly as in the Phase 1
checklist (small quantity, e.g. `0.01`).

**Expected result:** "Last Order Result" shows `FILLED` with a non-null
`fillPrice`/`fee`/`notional`; the Mock Account panel's cash balance decreases
accordingly. This proves the order pipeline still works correctly after the
`SignalEngineStrategy` confirmation-fetch parity change.

**Evidence:** Screenshot of the FILLED result and updated account panel.

### 6. Server restart resets state (unchanged from Phase 1 — re-verify briefly)

**Steps:** Note cash balance and positions, restart `npm run dev`, reload.

**Expected result:** Balance resets to `10000` USDT, positions clear.

**Evidence:** Cash balance and position list immediately after restart.

### 7. Browser console free of unexpected errors

**Steps:** Keep DevTools Console visible throughout items 1–6.

**Expected result:** No uncaught exceptions or React errors originating from
`TradingBotPageClient` or the trading-signals/trading-bot API responses. A
`401` during the initial signed-out redirect is expected, not a failure.

**Evidence:** Screenshot or copy of the console output, or explicit
confirmation "console clear."

---

## Result

All seven items passed on 2026-07-14. Phase 2 is fully accepted.
`ROADMAP.md`'s entry has moved from "Implementation complete — acceptance
pending" to "Completed."
