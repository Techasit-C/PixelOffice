import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { toErrorResponse } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { verifySharedSecret } from "@/lib/api/verify-secret";
import { addAlert, getAlerts } from "@/lib/tradingview-alerts";

// Two callers, two auth models:
//   POST — TradingView's servers (a MACHINE, no user session): gated by a fail-closed
//          shared secret sent in the X-Webhook-Secret header.
//   GET  — the dashboard (a signed-in USER): gated by requireUser + per-user rate limit.
// Node runtime: crypto (constant-time compare) + the limiter need a Node context.
export const runtime = "nodejs";

/**
 * Receives TradingView alert webhooks (POST).
 *
 * In TradingView, set the alert's webhook URL to:
 *   https://<your-public-domain>/api/tradingview-webhook
 * and add a custom HTTP header:
 *   X-Webhook-Secret: <TRADINGVIEW_WEBHOOK_SECRET>
 *
 * The secret is REQUIRED: if TRADINGVIEW_WEBHOOK_SECRET is unset/empty the endpoint
 * fails CLOSED and rejects every request (it never runs unauthenticated). The secret
 * is compared in constant time and is never logged or echoed.
 *
 * Suggested alert message body (TradingView placeholders get substituted before sending):
 *   {"symbol": "{{ticker}}", "action": "buy", "price": {{close}}, "strategy": "my-strategy"}
 *
 * NOTE: this only works once the app is reachable from the public internet
 * (deployed, or tunneled e.g. via ngrok) — TradingView's servers can't reach
 * localhost directly.
 */
export async function POST(req: NextRequest) {
  // Fail-closed shared-secret gate. Read from the X-Webhook-Secret request header (not
  // the query string, which lands in access logs / proxies) and compared in constant
  // time. An unset/empty secret OR a mismatch both return a generic 401 — do not reveal
  // which, and never echo the secret.
  //
  // NOTE: no per-user rate limit here — this caller has NO user identity. IP-based /
  // global rate limiting (e.g. at the edge/proxy) is future work.
  if (
    !verifySharedSecret(
      req.headers.get("x-webhook-secret"),
      process.env.TRADINGVIEW_WEBHOOK_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bodyText = await req.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }

  addAlert({
    id: randomUUID(),
    raw: bodyText,
    symbol: typeof parsed?.symbol === "string" ? parsed.symbol : undefined,
    action: typeof parsed?.action === "string" ? parsed.action : undefined,
    price: typeof parsed?.price === "number" ? parsed.price : undefined,
    strategy: typeof parsed?.strategy === "string" ? parsed.strategy : undefined,
    receivedAt: new Date().toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });

  return NextResponse.json({ ok: true });
}

// Dashboard read of buffered alerts — auth-gated + per-user rate limited (signalsRead).
export async function GET() {
  try {
    const { userId } = await requireUser();
    enforceRateLimit(userId, "signalsRead");
    return NextResponse.json({ alerts: getAlerts() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
