import { createHmac } from "crypto";
import { redactSecrets } from "@/lib/market-data/redact";

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
const CONTRACT_BASE_URL = "https://contract.mexc.com";


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
export async function fetchMexcSpotAccount(opts: {
  apiKey: string;
  apiSecret: string;
}) {
  const account = await signedGet<{
    balances: Array<{
      asset: string;
      free: string;
      locked: string;
    }>;
  }>({
    apiKey: opts.apiKey,
    apiSecret: opts.apiSecret,
    path: "/api/v3/account",
  });

  return account;
}

export async function fetchMexcSpotOpenOrders(opts: {
  apiKey: string;
  apiSecret: string;
}) {
  const orders = await signedGet<
    Array<{
      symbol: string;
      side: string;
      type: string;
      price: string;
      origQty: string;
      executedQty: string;
      status: string;
    }>
  >({
    apiKey: opts.apiKey,
    apiSecret: opts.apiSecret,
    path: "/api/v3/openOrders",
  });

  return orders;
}
// ---------------------------------------------------------------------------
// MEXC Futures (Contract) — READ-ONLY client.
//
// The contract API (https://contract.mexc.com) uses a DIFFERENT auth scheme from
// spot v3:
//   - headers: `ApiKey`, `Request-Time` (ms epoch), `Signature`, `Content-Type`
//   - signature target = apiKey + requestTime + parameterString
//   - GET parameterString = params sorted by key ascending, joined `k=v&k2=v2`
//   - signature = HMAC_SHA256(secret, target) hex, lowercase
//   - responses are wrapped `{ success, code, data }`.
//
// TODO(CR-MEXC-FUTURES-01): this signing scheme follows MEXC's documented contract
// v1 API but could NOT be verified against the live contract API in this
// environment (no outbound access / no futures-enabled key). MEXC has also
// restricted contract-API access for many accounts. Every helper below therefore
// SWALLOWS all failures (missing key / 401/403 permission / host / signature) and
// returns null so the FUTURES section degrades to `source: "unavailable"` — it
// never throws to the route and never fabricates numbers. ONLY genuine `data` from
// a successful read is ever surfaced.
//
// SECURITY: read-only endpoints only (account assets / open positions / open
// orders). No trade / withdraw / transfer / leverage-change endpoint is called.
// The API key/secret are never logged; caught errors go through redactSecrets().
// ---------------------------------------------------------------------------

export interface MexcFuturesAssetRaw {
  currency: string;
  equity?: number | string;
  cashBalance?: number | string;
  availableBalance?: number | string;
  frozenBalance?: number | string;
  unrealized?: number | string;
  positionMargin?: number | string;
}

export interface MexcFuturesPositionRaw {
  symbol: string;
  positionType?: number; // 1 = long, 2 = short
  holdVol?: number | string;
  holdAvgPrice?: number | string;
  openAvgPrice?: number | string;
  markPrice?: number | string;
  unrealized?: number | string;
}

export interface MexcFuturesOrderRaw {
  symbol: string;
  side?: number; // 1 open long, 2 close short, 3 open short, 4 close long
  orderType?: number; // 1 limit, 5 market, ...
  price?: number | string;
  vol?: number | string;
  state?: number; // 2 = uncompleted/open
}

interface ContractEnvelope<T> {
  success?: boolean;
  code?: number;
  message?: string;
  data?: T;
}

function contractSign(
  secret: string,
  apiKey: string,
  requestTime: string,
  parameterString: string,
): string {
  return createHmac("sha256", secret)
    .update(apiKey + requestTime + parameterString)
    .digest("hex");
}

async function contractSignedGet<T>(opts: {
  apiKey: string;
  apiSecret: string;
  path: string;
  params?: Record<string, string>;
}): Promise<T> {
  const requestTime = Date.now().toString();
  // GET parameter string: keys sorted ascending, joined `k=v&k2=v2`.
  const parameterString = Object.entries(opts.params ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const signature = contractSign(
    opts.apiSecret,
    opts.apiKey,
    requestTime,
    parameterString,
  );
  const url = parameterString
    ? `${CONTRACT_BASE_URL}${opts.path}?${parameterString}`
    : `${CONTRACT_BASE_URL}${opts.path}`;

  const res = await fetch(url, {
    headers: {
      ApiKey: opts.apiKey,
      "Request-Time": requestTime,
      Signature: signature,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `MEXC contract request failed: ${res.status} ${res.statusText} — ${body}`,
    );
  }
  const json = (await res.json()) as ContractEnvelope<T>;
  if (json.success === false) {
    throw new Error(
      `MEXC contract error: code=${json.code} ${json.message ?? ""}`,
    );
  }
  return (json.data ?? ([] as unknown)) as T;
}

/** Contract account assets (wallet equity / available / unrealized PnL). */
export async function fetchMexcFuturesAccount(opts: {
  apiKey: string;
  apiSecret: string;
}): Promise<MexcFuturesAssetRaw[] | null> {
  try {
    return await contractSignedGet<MexcFuturesAssetRaw[]>({
      ...opts,
      path: "/api/v1/private/account/assets",
    });
  } catch (err) {
    console.error("[mexc] futures account fetch failed:", redactSecrets(err));
    return null;
  }
}

/** Currently open contract positions. */
export async function fetchMexcFuturesOpenPositions(opts: {
  apiKey: string;
  apiSecret: string;
}): Promise<MexcFuturesPositionRaw[] | null> {
  try {
    return await contractSignedGet<MexcFuturesPositionRaw[]>({
      ...opts,
      path: "/api/v1/private/position/open_positions",
    });
  } catch (err) {
    console.error("[mexc] futures positions fetch failed:", redactSecrets(err));
    return null;
  }
}

/** Currently open / pending contract orders. */
export async function fetchMexcFuturesOpenOrders(opts: {
  apiKey: string;
  apiSecret: string;
}): Promise<MexcFuturesOrderRaw[] | null> {
  try {
    return await contractSignedGet<MexcFuturesOrderRaw[]>({
      ...opts,
      path: "/api/v1/private/order/list/open_orders",
    });
  } catch (err) {
    console.error("[mexc] futures orders fetch failed:", redactSecrets(err));
    return null;
  }
}
