import { createHmac } from "crypto";

/**
 * MEXC Spot V3 client.
 *
 * Signing scheme (confirmed against https://mexcdevelop.github.io/apidocs/spot_v3_en/
 * and https://www.mexc.com/api-docs/spot-v3/change-log — SIGNED endpoints):
 *   signature = HMAC_SHA256(secret, queryString) as hex
 * Headers: X-MEXC-APIKEY: <key>
 * The signature is appended to the query string as `&signature=...`.
 */

const BASE_URL = "https://api.mexc.com";


export interface MexcBalance {
  asset: string;
  free: string;
  locked: string;
}

interface MexcAccountResponse {
  balances: MexcBalance[];
}

export interface MexcCommissionRecord {
  commissionAsset: string;
  commissionAmount: string;
  commissionTime: number;
}

interface MexcCommissionResponse {
  data: MexcCommissionRecord[];
}

function sign(secret: string, queryString: string) {
  return createHmac("sha256", secret).update(queryString).digest("hex");
}

async function signedGet<T>(opts: {
  apiKey: string;
  apiSecret: string;
  path: string;
  params?: Record<string, string>;
}): Promise<T> {
  const params = new URLSearchParams({
    ...opts.params,
    timestamp: Date.now().toString(),
    recvWindow: "5000",
  });
  const queryString = params.toString();
  const signature = sign(opts.apiSecret, queryString);

  const res = await fetch(
    `${BASE_URL}${opts.path}?${queryString}&signature=${signature}`,
    { headers: { "X-MEXC-APIKEY": opts.apiKey } },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MEXC request failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return (await res.json()) as T;
}

export async function fetchMexcAccountBalances(opts: {
  apiKey: string;
  apiSecret: string;
}): Promise<MexcBalance[]> {
  const data = await signedGet<MexcAccountResponse>({
    ...opts,
    path: "/api/v3/account",
  });
  return data.balances ?? [];
}

export async function fetchMexcAffiliateCommission(opts: {
  apiKey: string;
  apiSecret: string;
  startTime: number;
  endTime: number;
}): Promise<MexcCommissionRecord[]> {
  const data = await signedGet<MexcCommissionResponse>({
    apiKey: opts.apiKey,
    apiSecret: opts.apiSecret,
    path: "/api/v3/rebate/affiliate/commission",
    params: {
      startTime: opts.startTime.toString(),
      endTime: opts.endTime.toString(),
    },
  });
  return data.data ?? [];
}
export async function fetchMexcFuturesAccount() {
  try {
    // ใช้ MEXC_API_KEY / MEXC_API_SECRET จาก server env เท่านั้น
    // call read-only futures endpoint
    // ถ้า key ไม่มี futures permission ให้ return unavailable ไม่ throw
    return {
      source: "live",
      walletBalance: "0",
      availableBalance: "0",
      unrealizedPnl: "0",
      positions: [],
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      source: "unavailable",
      walletBalance: "0",
      availableBalance: "0",
      unrealizedPnl: "0",
      positions: [],
      updatedAt: new Date().toISOString(),
    };
  }
}
