import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { addAlert, getAlerts } from "@/lib/tradingview-alerts";

/**
 * Receives TradingView alert webhooks.
 *
 * In TradingView, set the alert's webhook URL to:
 *   https://<your-public-domain>/api/tradingview-webhook?secret=<TRADINGVIEW_WEBHOOK_SECRET>
 * (only enforced if that env var is set — leave it unset while testing locally)
 *
 * Suggested alert message body (TradingView placeholders get substituted before sending):
 *   {"symbol": "{{ticker}}", "action": "buy", "price": {{close}}, "strategy": "my-strategy"}
 *
 * NOTE: this only works once the app is reachable from the public internet
 * (deployed, or tunneled e.g. via ngrok) — TradingView's servers can't reach
 * localhost directly.
 */

export async function POST(req: NextRequest) {
  const requiredSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET;
  if (requiredSecret) {
    const provided = req.nextUrl.searchParams.get("secret");
    if (provided !== requiredSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
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

export async function GET() {
  return NextResponse.json({ alerts: getAlerts() });
}
