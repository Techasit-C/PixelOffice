// Trade-ledger-only CSV export (spec §12/§14 — no equity-curve CSV is offered, full-
// resolution or otherwise). Pure string formatting, no DOM — the UI component wires
// this to a client-side download.
//
// SCHEMA-AWARE by design: formula-injection neutralization (OWASP CSV Injection)
// applies only to genuinely free-text columns. Monetary/quantity fields are strictly
// validated against the exact fixed-point format toFixedString() (lib/backtest/
// decimal.ts) produces — Decimal#toFixed(8) is guaranteed non-exponential — and, once
// validated, are exported as plain numeric literals, INCLUDING negative values like
// realizedPnl "-9.79000000". This is safe specifically because the value has already
// been proven to contain nothing but an optional leading "-", digits, and a decimal
// point: a spreadsheet parses that unambiguously as a number and never as a formula,
// so there is nothing here for injection protection to guard against. A value that
// fails the fixed-point check is REJECTED (throws), never silently passed through as
// trusted text — CSV export must not paper over a malformed monetary field.
import type { TradeLedgerEntry } from "./types";

export class CsvExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvExportError";
  }
}

export const CSV_COLUMNS: (keyof TradeLedgerEntry)[] = [
  "entryTime", "entryPrice", "quantity", "entryNotional", "entryFee", "entryCost",
  "exitTime", "exitPrice", "exitReason", "exitNotional", "exitFee", "exitProceeds",
  "realizedPnl", "intendedRiskBudget", "actualNetRisk", "actualRiskFraction",
  "cashCapped", "netRiskReward", "warnings",
];

const MONETARY_COLUMNS = new Set<keyof TradeLedgerEntry>([
  "entryPrice", "quantity", "entryNotional", "entryFee", "entryCost",
  "exitPrice", "exitNotional", "exitFee", "exitProceeds", "realizedPnl",
  "intendedRiskBudget", "actualNetRisk",
]);
const TIMESTAMP_COLUMNS = new Set<keyof TradeLedgerEntry>(["entryTime", "exitTime"]);
const NUMERIC_FRACTION_COLUMNS = new Set<keyof TradeLedgerEntry>(["actualRiskFraction", "netRiskReward"]);
const BOOLEAN_COLUMNS = new Set<keyof TradeLedgerEntry>(["cashCapped"]);
// Everything else (exitReason, warnings) is genuinely textual and goes through the
// escaping + formula-injection path below.

// Exactly the format toFixedString() produces: an optional leading "-", one or more
// digits, a decimal point, and exactly 8 digits. Decimal#toFixed(8) never emits
// exponential notation, so this is a strict equality check, not a loose numeric parse.
const FIXED_POINT_DECIMAL = /^-?\d+\.\d{8}$/;

// Spreadsheet-formula-injection guard (OWASP CSV Injection), applied ONLY to textual
// cells: a cell opened in Excel/Sheets/LibreOffice is evaluated as a formula if its
// first character is one of =, +, -, @, a tab, or a carriage return.
const FORMULA_TRIGGER_PREFIX = /^[=+\-@\t\r]/;

function neutralizeFormulaPrefix(raw: string): string {
  return FORMULA_TRIGGER_PREFIX.test(raw) ? `'${raw}` : raw;
}

function escapeCsvSyntax(raw: string): string {
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n") || raw.includes("\r")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function monetaryField(raw: string, col: keyof TradeLedgerEntry): string {
  if (!FIXED_POINT_DECIMAL.test(raw)) {
    throw new CsvExportError(`Malformed monetary value in column "${String(col)}": ${JSON.stringify(raw)}`);
  }
  return raw;
}

function timestampField(raw: number, col: keyof TradeLedgerEntry): string {
  if (!Number.isInteger(raw) || raw < 0) {
    throw new CsvExportError(`Malformed timestamp in column "${String(col)}": ${JSON.stringify(raw)}`);
  }
  return String(raw);
}

function numericFractionField(raw: number, col: keyof TradeLedgerEntry): string {
  if (!Number.isFinite(raw)) {
    throw new CsvExportError(`Malformed numeric value in column "${String(col)}": ${JSON.stringify(raw)}`);
  }
  return String(raw);
}

function booleanField(raw: unknown, col: keyof TradeLedgerEntry): string {
  if (typeof raw !== "boolean") {
    throw new CsvExportError(`Malformed boolean value in column "${String(col)}": ${JSON.stringify(raw)}`);
  }
  return String(raw);
}

function textualField(value: unknown): string {
  const joined = Array.isArray(value) ? value.join("; ") : String(value);
  return escapeCsvSyntax(neutralizeFormulaPrefix(joined));
}

function csvField(entry: TradeLedgerEntry, col: keyof TradeLedgerEntry): string {
  const value = entry[col];
  if (MONETARY_COLUMNS.has(col)) return monetaryField(value as string, col);
  if (TIMESTAMP_COLUMNS.has(col)) return timestampField(value as number, col);
  if (NUMERIC_FRACTION_COLUMNS.has(col)) return numericFractionField(value as number, col);
  if (BOOLEAN_COLUMNS.has(col)) return booleanField(value, col);
  return textualField(value);
}

export function tradeLedgerToCsv(entries: TradeLedgerEntry[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = entries.map((entry) => CSV_COLUMNS.map((col) => csvField(entry, col)).join(","));
  return [header, ...rows].join("\n") + "\n";
}
