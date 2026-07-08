// Display-only formatting for the portfolio UI.
//
// IMPORTANT: money/quantity values arrive from the API as STRINGS and the backend
// has already computed every figure. Nothing here does financial arithmetic — the
// only use of `Number()` is to hand a value to Intl for locale grouping at render
// time (never to derive a new stored/persisted amount). Sign is detected from the
// string itself so we never rely on float parsing for correctness of +/- coloring.

const DASH = "—";

/** -1 / 0 / +1 from a decimal string, without float math. */
export function decimalSign(s: string | null | undefined): -1 | 0 | 1 {
  if (s == null) return 0;
  const t = s.trim();
  if (t === "") return 0;
  if (t.startsWith("-")) return -1;
  if (/^\+?0+(\.0+)?$/.test(t)) return 0;
  return 1;
}

/** Tailwind text color for a signed decimal string (matches existing signColor). */
export function signClass(s: string): string {
  const sign = decimalSign(s);
  if (sign < 0) return "text-danger";
  if (sign > 0) return "text-success";
  return "text-muted-foreground";
}

/** Tailwind text color for an already-numeric percentage. */
export function signClassNum(n: number): string {
  if (n < 0) return "text-danger";
  if (n > 0) return "text-success";
  return "text-muted-foreground";
}

function toNumberForDisplay(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** ฿ formatting for a THB decimal string. Whole baht by default (large portfolio sums). */
export function formatThb(
  s: string,
  { decimals = 0, sign = false }: { decimals?: number; sign?: boolean } = {},
): string {
  const n = toNumberForDisplay(s);
  if (n === null) return DASH;
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const neg = decimalSign(s) < 0;
  const plus = sign && decimalSign(s) > 0 ? "+" : "";
  return `${neg ? "-" : plus}฿${body}`;
}

/** $ formatting for a USD decimal string. */
export function formatUsd(
  s: string,
  { decimals = 2, sign = false }: { decimals?: number; sign?: boolean } = {},
): string {
  const n = toNumberForDisplay(s);
  if (n === null) return DASH;
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const neg = decimalSign(s) < 0;
  const plus = sign && decimalSign(s) > 0 ? "+" : "";
  return `${neg ? "-" : plus}$${body}`;
}

/** Native-currency price/amount with a currency code suffix (USD/THB/etc). */
export function formatNative(s: string, currency: string, decimals = 2): string {
  const symbol = currency === "USD" ? "$" : currency === "THB" ? "฿" : "";
  const n = toNumberForDisplay(s);
  if (n === null) return DASH;
  const body = n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return symbol ? `${symbol}${body}` : `${body} ${currency}`;
}

/** Share/coin quantity — trims to a sane precision without inventing digits. */
export function formatQuantity(s: string): string {
  const n = toNumberForDisplay(s);
  if (n === null) return DASH;
  const abs = Math.abs(n);
  const decimals = abs >= 1 ? 4 : 8;
  return n
    .toLocaleString("en-US", { maximumFractionDigits: decimals })
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

/** Signed percentage, already numeric from the API. */
export function formatPct(n: number, { sign = true } = {}): string {
  if (!Number.isFinite(n)) return DASH;
  const plus = sign && n > 0 ? "+" : "";
  return `${plus}${n.toFixed(2)}%`;
}

/** Progress percentage clamped to 0..100 for bar widths. */
export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Compact ISO date -> local yyyy-mm-dd hh:mm for the ledger. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO date only (yyyy-mm-dd) for date inputs. */
export function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
