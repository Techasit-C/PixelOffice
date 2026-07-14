// STATIC SAFETY GUARD — mirrors tests/trading-signals-safety.test.ts. Enforces
// that the mock trading-bot module never imports the signed-key exchange
// client and never references broker credentials or a live-mode identifier.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const FORBIDDEN_IMPORT = /@\/lib\/exchanges/i;
const FORBIDDEN_TEXT = /MEXC_API_KEY|MEXC_API_SECRET|isLiveMode|LIVE_TRADING|liveTradingEnabled/i;

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /import\s+[^"';]*from\s*["']([^"']+)["']/g,
    /import\s*["']([^"']+)["']/g,
    /export\s+[^"';]*from\s*["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

describe("trading-bot safety invariant (static import-graph scan)", () => {
  const targets = [
    ...tsFilesUnder(join(ROOT, "lib", "trading-bot")),
    ...tsFilesUnder(join(ROOT, "app", "api", "trading-bot")),
  ];

  it("scans a non-empty set of trading-bot files", () => {
    expect(targets.length).toBeGreaterThanOrEqual(10);
  });

  it("no file imports lib/exchanges (the signed-key MEXC client)", () => {
    const violations: string[] = [];
    for (const file of targets) {
      const src = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        if (FORBIDDEN_IMPORT.test(spec)) violations.push(`${file} -> "${spec}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no file references broker credential env vars or a live-mode identifier", () => {
    const violations: string[] = [];
    for (const file of targets) {
      const src = readFileSync(file, "utf8");
      const match = src.match(FORBIDDEN_TEXT);
      if (match) violations.push(`${file} -> "${match[0]}"`);
    }
    expect(violations).toEqual([]);
  });
});
