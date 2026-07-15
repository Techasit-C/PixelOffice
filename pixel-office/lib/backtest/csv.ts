// Trade-ledger-only CSV export (spec §12/§14 — no equity-curve CSV is offered, full-
// resolution or otherwise). Pure string formatting, no DOM — the UI component wires
// this to a client-side download.
import type { TradeLedgerEntry } from "./types";

const COLUMNS: (keyof TradeLedgerEntry)[] = [
  "entryTime", "entryPrice", "quantity", "entryNotional", "entryFee", "entryCost",
  "exitTime", "exitPrice", "exitReason", "exitNotional", "exitFee", "exitProceeds",
  "realizedPnl", "intendedRiskBudget", "actualNetRisk", "actualRiskFraction",
  "cashCapped", "netRiskReward", "warnings",
];

// Spreadsheet-formula-injection guard (OWASP CSV Injection): a cell opened in
// Excel/Sheets/LibreOffice is evaluated as a formula if its FIRST character is one
// of =, +, -, @, a tab, or a carriage return — regardless of which column it's in.
// CSV carries no per-column type information, so this is applied uniformly to every
// field, including legitimate negative numeric values (e.g. realizedPnl "-9.79"
// becomes "'-9.79"). The leading single quote is the standard neutralization: every
// major spreadsheet application forces text interpretation and hides the quote
// itself, at the cost of that cell no longer being read back as a native number.
const FORMULA_TRIGGER_PREFIX = /^[=+\-@\t\r]/;

function neutralizeFormulaPrefix(raw: string): string {
  return FORMULA_TRIGGER_PREFIX.test(raw) ? `'${raw}` : raw;
}

function csvField(value: unknown): string {
  const joined = Array.isArray(value) ? value.join("; ") : String(value);
  const neutralized = neutralizeFormulaPrefix(joined);
  if (neutralized.includes(",") || neutralized.includes('"') || neutralized.includes("\n") || neutralized.includes("\r")) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export function tradeLedgerToCsv(entries: TradeLedgerEntry[]): string {
  const header = COLUMNS.join(",");
  const rows = entries.map((entry) => COLUMNS.map((col) => csvField(entry[col])).join(","));
  return [header, ...rows].join("\n") + "\n";
}
