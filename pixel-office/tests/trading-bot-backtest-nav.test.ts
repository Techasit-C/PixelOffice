// Static regression check (matches this repo's established pattern — see
// trading-signals-safety.test.ts — of scanning raw source text rather than rendering
// components, since no React Testing Library / jsdom harness is configured here).
//
// Guards a real usability defect found during Phase 3 manual acceptance: /trading-bot
// and /trading-bot/backtest existed but had no link between them. This proves the fix
// stays in place — a real next/link <Link>, not a manually-built URL string.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const TRADING_BOT_CLIENT = join(ROOT, "components", "trading-bot", "TradingBotPageClient.tsx");
const BACKTEST_CLIENT = join(ROOT, "components", "trading-bot", "BacktestPageClient.tsx");

describe("trading-bot <-> backtest cross-navigation (static source check)", () => {
  it("TradingBotPageClient imports next/link and links to /trading-bot/backtest", () => {
    const src = readFileSync(TRADING_BOT_CLIENT, "utf8");
    expect(src).toMatch(/import\s+Link\s+from\s+["']next\/link["']/);
    expect(src).toMatch(/<Link\s+[^>]*href=["']\/trading-bot\/backtest["']/);
  });

  it("BacktestPageClient imports next/link and links back to /trading-bot", () => {
    const src = readFileSync(BACKTEST_CLIENT, "utf8");
    expect(src).toMatch(/import\s+Link\s+from\s+["']next\/link["']/);
    expect(src).toMatch(/<Link\s+[^>]*href=["']\/trading-bot["']/);
  });

  it("neither page builds the cross-navigation link via a raw <a> tag or manual URL manipulation", () => {
    for (const file of [TRADING_BOT_CLIENT, BACKTEST_CLIENT]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/<a\s+[^>]*href=["']\/trading-bot/);
      expect(src).not.toMatch(/window\.location(\.href)?\s*=\s*["'`]\/trading-bot/);
      expect(src).not.toMatch(/router\.push\(\s*["'`]\/trading-bot/);
    }
  });

  it("both cross-navigation links carry an explicit accessible label", () => {
    const tradingBotSrc = readFileSync(TRADING_BOT_CLIENT, "utf8");
    const backtestSrc = readFileSync(BACKTEST_CLIENT, "utf8");
    // Either an aria-label or non-empty visible text between the tags satisfies an
    // accessible name; this repo's fix uses aria-label plus matching visible text.
    expect(tradingBotSrc).toMatch(/href=["']\/trading-bot\/backtest["'][^>]*aria-label=["'][^"']+["']/);
    expect(backtestSrc).toMatch(/href=["']\/trading-bot["'][^>]*aria-label=["'][^"']+["']/);
  });

  it("both pages remain wrapped in PageShell, so route-level auth protection (middleware.ts /trading-bot(.*)) is untouched", () => {
    // The fix only adds a Link inside the existing PixelCard header; it must never
    // introduce a second page shell or bypass the shared authenticated layout.
    for (const file of [TRADING_BOT_CLIENT, BACKTEST_CLIENT]) {
      const src = readFileSync(file, "utf8");
      const pageShellOpenCount = (src.match(/<PageShell\b/g) ?? []).length;
      expect(pageShellOpenCount).toBe(1);
    }
  });
});
