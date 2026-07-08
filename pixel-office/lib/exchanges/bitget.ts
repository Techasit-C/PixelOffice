import { createHmac } from "crypto";

/**
 * Bitget affiliate-commissions client.
 *
 * Endpoint confirmed via live docs fetch on 2026-07-05:
 * https://www.bitget.com/api-doc/affiliate/customerInfo/GetDirectCommissions
 *   GET /api/v2/broker/customer-commissions  (max 30-day range per request)
 *
 * Signing scheme (Bitget V2, standard):
 *   prehash = timestamp + method.toUpperCase() + requestPath(+queryString) + body
 *   sign = Base64(HMAC_SHA256(secret, prehash))
 * Headers: ACCESS-KEY, ACCESS-SIGN, ACCESS-PASSPHRASE, ACCESS-TIMESTAMP
 */

const BASE_URL = "https://api.bitget.com";
const REQUEST_PATH = "/api/v2/broker/customer-commissions";

export interface BitgetCommissionRecord {
  uid: string;
  date: string;
  coin: string;
  symbol: string;
  dealAmount: string;
  feePaid: string;
  rebateAmount: string;
  totalRebateAmount: string;
}

interface BitgetCommissionResponse {
  code: string;
  msg: string;
  requestTime: number;
  data: {
    commissionList: BitgetCommissionRecord[];
    endId?: string;
  };
}

function sign(secret: string, prehash: string) {
  return createHmac("sha256", secret).update(prehash).digest("base64");
}

export async function fetchBitgetCommissions(opts: {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  startTime?: number;
  endTime?: number;
}): Promise<BitgetCommissionRecord[]> {
  const params = new URLSearchParams();
  if (opts.startTime) params.set("startTime", opts.startTime.toString());
  if (opts.endTime) params.set("endTime", opts.endTime.toString());
  params.set("limit", "100");
  const queryString = `?${params.toString()}`;

  const timestamp = Date.now().toString();
  const prehash = timestamp + "GET" + REQUEST_PATH + queryString;
  const signature = sign(opts.apiSecret, prehash);

  const res = await fetch(`${BASE_URL}${REQUEST_PATH}${queryString}`, {
    headers: {
      "ACCESS-KEY": opts.apiKey,
      "ACCESS-SIGN": signature,
      "ACCESS-PASSPHRASE": opts.passphrase,
      "ACCESS-TIMESTAMP": timestamp,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Bitget request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as BitgetCommissionResponse;
  if (data.code !== "00000") {
    throw new Error(`Bitget API error ${data.code}: ${data.msg}`);
  }
  return data.data.commissionList ?? [];
}
