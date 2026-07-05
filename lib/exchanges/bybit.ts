import { createHmac } from "crypto";

/**
 * Bybit V5 broker-earnings client.
 *
 * IMPORTANT — verify before going live:
 * - The "Get Earning" endpoint (https://bybit-exchange.github.io/docs/v5/broker/exchange-earning)
 *   requires an *exchange broker* master-account API key with broker/affiliate
 *   permission ticked — a normal spot/derivatives trading key will get a
 *   permission error here. Confirm your account is enrolled in Bybit's broker
 *   or affiliate program before relying on this.
 * - The exact query param names (`begin`/`end` vs `startTime`/`endTime`) could
 *   not be confirmed from a live fetch of the docs page at the time this was
 *   written (it 404'd) — cross-check against the docs link above once you
 *   have a real key, and adjust `buildQuery` if needed.
 *
 * Signing scheme (V5, well-documented and stable):
 *   sign = HMAC_SHA256(secret, timestamp + apiKey + recvWindow + queryString) as hex
 */

const BASE_URL = "https://api.bybit.com";
const RECV_WINDOW = "5000";

export interface BybitEarningRecord {
  userId: string;
  bizType: string;
  symbol: string;
  coin: string;
  earning: string;
  orderId: string;
  execTime: string;
}

interface BybitEarningResponse {
  retCode: number;
  retMsg: string;
  result: {
    list: BybitEarningRecord[];
    nextPageCursor?: string;
  };
}

function sign(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function buildQuery(params: Record<string, string | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [
    string,
    string,
  ][];
  return entries.map(([k, v]) => `${k}=${v}`).join("&");
}

export async function fetchBybitEarnings(opts: {
  apiKey: string;
  apiSecret: string;
  startTime?: number;
  endTime?: number;
}): Promise<BybitEarningRecord[]> {
  const timestamp = Date.now().toString();
  const query = buildQuery({
    startTime: opts.startTime?.toString(),
    endTime: opts.endTime?.toString(),
    limit: "50",
  });

  const payload = timestamp + opts.apiKey + RECV_WINDOW + query;
  const signature = sign(opts.apiSecret, payload);

  const res = await fetch(
    `${BASE_URL}/v5/broker/earnings-info${query ? `?${query}` : ""}`,
    {
      headers: {
        "X-BAPI-API-KEY": opts.apiKey,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": RECV_WINDOW,
        "X-BAPI-SIGN": signature,
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Bybit request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as BybitEarningResponse;
  if (data.retCode !== 0) {
    throw new Error(`Bybit API error ${data.retCode}: ${data.retMsg}`);
  }
  return data.result.list;
}
