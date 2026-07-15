// STATIC SAFETY GUARD — enforces the non-negotiable invariant that the signal
// engine and its route are structurally incapable of trading. We read the source
// text of every file under lib/trading-signals/ and the route, extract every import
// specifier, and FAIL if any of them references an exchange (signed-key) client or
// an order/withdraw/transfer/execute capability.
//
// This is a build-time trip-wire: if a future edit imports a trading capability, CI
// goes red before the code can ship.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// The forbidden surface: exchange clients + any execution/movement verb.
const FORBIDDEN =
  /@\/lib\/exchanges|order|withdraw|transfer|execute|placeOrder|cancelOrder|leverage/i;

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Extract the specifier of every static/dynamic import + re-export in `src`. */
function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /import\s+[^"';]*from\s*["']([^"']+)["']/g, // import ... from "x"
    /import\s*["']([^"']+)["']/g, // side-effect import "x"
    /export\s+[^"';]*from\s*["']([^"']+)["']/g, // re-export from "x"
    /import\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("x")
    /require\s*\(\s*["']([^"']+)["']\s*\)/g, // require("x")
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

describe("trading-signals safety invariant (static import-graph scan)", () => {
  const targets = [
    ...tsFilesUnder(join(ROOT, "lib", "trading-signals")),
    ...tsFilesUnder(join(ROOT, "lib", "backtest")),
    join(ROOT, "lib", "market-data", "candles.ts"),
    join(ROOT, "app", "api", "trading-signals", "route.ts"),
  ];

  it("scans a non-empty set of engine/route files", () => {
    expect(targets.length).toBeGreaterThanOrEqual(7);
  });

  it("no engine/route file imports an exchange client or execution capability", () => {
    const violations: string[] = [];
    for (const file of targets) {
      const src = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        if (FORBIDDEN.test(spec)) {
          violations.push(`${file} -> "${spec}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("lib/backtest/ safety boundary (deterministic core)", () => {
  const backtestFiles = tsFilesUnder(join(ROOT, "lib", "backtest"));
  const EXTRA_FORBIDDEN = /@\/lib\/market-data\/historical-candles|@\/lib\/trading-bot\//;

  it("scans a non-empty set of backtest files", () => {
    expect(backtestFiles.length).toBeGreaterThan(0);
  });

  it("no backtest file imports the historical fetch module, trading-bot, or a forbidden execution capability", () => {
    const violations: string[] = [];
    for (const file of backtestFiles) {
      const src = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        if (FORBIDDEN.test(spec) || EXTRA_FORBIDDEN.test(spec)) {
          violations.push(`${file} -> "${spec}"`);
        }
      }
      if (/\bgetCandles\b/.test(src)) {
        violations.push(`${file} references getCandles (forbidden — live fetch, not for the deterministic core)`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("any import of lib/market-data/candles.ts from lib/backtest/ is type-only", () => {
    const violations: string[] = [];
    for (const file of backtestFiles) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        const mentionsCandles = line.includes('"@/lib/market-data/candles"') || line.includes("'@/lib/market-data/candles'");
        if (mentionsCandles && !/^\s*import\s+type\s/.test(line)) {
          violations.push(`${file}: "${line.trim()}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
