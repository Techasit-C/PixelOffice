/** Free, no-key exchange rate API — https://www.exchangerate-api.com/docs/free */
export async function fetchUsdToThbRate(): Promise<number> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", {
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`FX rate request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { rates?: Record<string, number> };
  const rate = data.rates?.THB;
  if (!rate) throw new Error("THB rate missing from FX response");
  return rate;
}
