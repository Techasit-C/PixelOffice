// FX provider — USD->THB only. Reuses the existing free, no-key endpoint via
// lib/fx-rate.ts (open.er-api.com). Quote/asset lookups are unsupported here.
import type { AssetType } from "@prisma/client";
import { fetchUsdToThbRate } from "@/lib/fx-rate";
import {
  UnsupportedAssetError,
  toDecimal,
  type FxQuote,
  type MarketDataProvider,
  type MarketQuote,
} from "./types";

// Mandate fallback (~33 THB/USD) used only when live FX and any cache are gone.
export const FX_FALLBACK_USD_THB = "33";

export class FxProvider implements MarketDataProvider {
  readonly name = "FxProvider";

  getQuote(_symbol: string, assetType: AssetType): Promise<MarketQuote> {
    throw new UnsupportedAssetError(assetType, `${this.name} (FX only)`);
  }

  async getFxUsdThb(): Promise<FxQuote> {
    const rate = await fetchUsdToThbRate();
    return { rate: toDecimal(rate), source: "live", fetchedAt: new Date() };
  }
}
