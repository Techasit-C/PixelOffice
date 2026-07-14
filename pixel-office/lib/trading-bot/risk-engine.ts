// Phase 1 risk gate — EXACTLY these four rules, nothing else. This is NOT the
// full Risk Engine (no daily loss limit, drawdown, exposure cap, cooldown,
// session restriction, circuit breaker, kill switch) — Phase 4 replaces this
// file's contents, not its interface. Signal-age and candle-freshness are
// deliberately NOT risk-engine rules — they gate intent construction upstream
// (Strategy for BUY, the close route for SELL); this engine only ever sees
// intents already built from fresh data.
import { estimateOrderCost, deriveBuyExecutionPrice } from "./pricing";
import { defaultReason } from "./errors";
import type { MockAccount, RejectCode, TradeIntent } from "./types";

export type RiskVerdict =
  | { approved: true }
  | { approved: false; code: RejectCode; reason: string };

export interface RiskEngine {
  evaluate(intent: TradeIntent, account: MockAccount): RiskVerdict;
}

function reject(code: RejectCode): RiskVerdict {
  return { approved: false, code, reason: defaultReason(code) };
}

export class StubRiskEngine implements RiskEngine {
  evaluate(intent: TradeIntent, account: MockAccount): RiskVerdict {
    if (
      !intent.requestedQuantity.isFinite() ||
      intent.requestedQuantity.isNegative() ||
      intent.requestedQuantity.isZero()
    ) {
      return reject("INVALID_QUANTITY");
    }

    if (intent.side === "BUY") {
      if (!intent.sourceSignal || intent.sourceSignal.stopLoss === null) {
        return reject("MISSING_STOP_LOSS");
      }
      const executionPrice = deriveBuyExecutionPrice(intent.sourceSignal);
      const notional = executionPrice.times(intent.requestedQuantity);
      const totalCost = estimateOrderCost(notional);
      if (totalCost.greaterThan(account.cashBalance)) {
        return reject("INSUFFICIENT_FUNDS");
      }
      return { approved: true };
    }

    // SELL
    const position = account.positions.get(intent.symbol);
    if (!position) return reject("NO_OPEN_POSITION");
    if (intent.requestedQuantity.greaterThan(position.quantity)) {
      return reject("INSUFFICIENT_POSITION");
    }
    return { approved: true };
  }
}

export const stubRiskEngine = new StubRiskEngine();
