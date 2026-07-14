# AI Trading Bot — Phase 1 Acceptance Checklist

Status of the implementation this checklist gates: **Implementation complete;
authenticated interactive acceptance pending.** All automated gates already pass
(218/218 tests, clean typecheck, clean lint, clean build, clean static safety scan —
see `docs/superpowers/specs/2026-07-14-trading-bot-phase1-design.md` for the full
verification record). This checklist covers the one thing automation in this
environment could not exercise: an authenticated human walking the real browser
flow end to end.

**Phase 1 is fully accepted only when every item below passes.** If any item
fails, it is a Phase 1 defect: fix only that defect, add an automated regression
test where practical, rerun the full verification suite (`npm test`, `npx tsc
--noEmit`, `npm run lint`, `npm run build`), and re-request acceptance — do not
expand scope or add functionality while fixing a failure here.

## How to run this checklist

```bash
cd pixel-office
npm run dev
```

Open `http://localhost:3000/trading-bot` in a browser with DevTools open (Console
tab). Sign in with a Clerk account when prompted. Keep DevTools open for the whole
session — item 9 depends on it.

---

## Checklist

### 1. Authenticated access

**Steps:** While signed out, visit `/trading-bot` directly. Sign in. Confirm you
land back on `/trading-bot`, not an error page.

**Expected result:** Signed-out visit redirects to sign-in; after signing in, the
page renders normally with your session active.

**Evidence to capture:** Screenshot of the page immediately after sign-in.

### 2. Visible Paper/Simulated and ephemeral-state warnings

**Steps:** Look at the top card on the page without scrolling.

**Expected result:** A banner is visible reading, in substance, "Paper trading
only — no real orders, no real money. This mode cannot be turned off," *and* a
second sentence stating account state is in-memory and resets on server restart
(no persistence in Phase 1). Neither statement is hidden behind a click or scroll.

**Evidence to capture:** Screenshot showing both sentences legible in one view.

### 3. Successful BUY

**Steps:** If a `LONG` signal is showing, enter a small quantity (e.g. `0.01`)
and click "Place Mock Order".

**Expected result:** The "Last Order Result" card shows `status: FILLED` with a
non-null `fillPrice`, `fee`, and `notional`; the Mock Account panel's cash balance
decreases by approximately `quantity × fillPrice × 1.001`; a new row appears under
Open Positions for that symbol.

**Evidence to capture:** Screenshot of the FILLED result and the updated account
panel side by side (or in sequence).

### 4. Oversized-order rejection without balance mutation

**Steps:** Note the current cash balance. Enter an oversized quantity (e.g.
`1000`) on a `LONG` signal and submit.

**Expected result:** "Last Order Result" shows `status: REJECTED`, `reasonCode:
INSUFFICIENT_FUNDS`, with a human-readable reason. The cash balance in the Mock
Account panel is **unchanged** from the value noted before the attempt.

**Evidence to capture:** Screenshot of the REJECTED result, plus before/after cash
balance values (numbers, not just a screenshot, since the difference is the point).

### 5. Rapid duplicate submission producing exactly one fill

**Steps:** With a valid quantity entered on a `LONG` signal, click "Place Mock
Order" twice in quick succession (before the first request visibly resolves).

**Expected result:** Exactly one fill occurs — the cash balance decreases only
once, and only one new position/quantity increase is reflected, not two. (The
second click reuses the same in-flight idempotency key held in the page's
component state.)

**Evidence to capture:** Cash balance before the double-click and after both
requests have resolved, showing only a single deduction's worth of change.

### 6. Position display

**Steps:** With at least one open position (from item 3), inspect the Open
Positions card.

**Expected result:** Each position row shows symbol, quantity, average entry
price, and realized P&L (starts at `0` before any close).

**Evidence to capture:** Screenshot of the Open Positions card with at least one
row populated.

### 7. Full-position close and realized P&L

**Steps:** Click "Close" on an open position, using the pre-filled (full)
quantity — do not edit it down.

**Expected result:** The quantity field was pre-filled with the full held
quantity by default (no need to type anything). After clicking, "Last Order
Result" shows `status: FILLED`, `side: SELL`, and a non-null `realizedPnl`. The
position disappears entirely from Open Positions (not left at zero quantity).
Cash balance increases accordingly.

**Evidence to capture:** Screenshot of the FILLED SELL result with `realizedPnl`
visible, and confirmation the position row is gone afterward.

### 8. Server restart resets state

**Steps:** Note the current cash balance and open positions. Stop the dev server
(`Ctrl+C`), restart it (`npm run dev`), and reload `/trading-bot` (same signed-in
session).

**Expected result:** The Mock Account panel shows the starting balance
(`10000` USDT) again and zero open positions — all state from before the restart
is gone. This is expected Phase 1 behavior (in-memory store, not a bug), and the
ephemeral-state warning from item 2 should have already told you to expect this.

**Evidence to capture:** Cash balance and position list immediately after restart.

### 9. Browser console free of unexpected errors

**Steps:** Throughout items 1–8, keep the DevTools Console tab visible.

**Expected result:** No uncaught exceptions, no React errors/warnings originating
from `TradingBotPageClient` or the trading-bot API responses. A `401` network
entry during the initial signed-out redirect (item 1) is expected and not a
failure. Any other red console error is a Phase 1 defect.

**Evidence to capture:** Screenshot or copy of the full console output for the
session, or explicit confirmation "console clear" if nothing appeared.

---

## Reporting results

For each item, record: pass/fail, the evidence captured, and — for any failure —
enough detail (request/response bodies, console stack trace, exact steps) to
reproduce it. Phase 1 moves from "Implementation complete; authenticated
interactive acceptance pending" to fully accepted (and `ROADMAP.md`'s entry moves
from "Implementation complete — acceptance pending" to "Completed") only after
all nine items report pass.
