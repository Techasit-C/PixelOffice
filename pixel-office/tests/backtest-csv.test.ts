import { describe, it, expect } from "vitest";
import { tradeLedgerToCsv } from "@/lib/backtest/csv";
import type { TradeLedgerEntry } from "@/lib/backtest/types";

function trade(overrides: Partial<TradeLedgerEntry> = {}): TradeLedgerEntry {
  return {
    entryTime: 1000, entryPrice: "100", quantity: "1", entryNotional: "100", entryFee: "0.1",
    entryCost: "100.1", exitTime: 2000, exitPrice: "110", exitReason: "TP1", exitNotional: "110",
    exitFee: "0.11", exitProceeds: "109.89", realizedPnl: "9.79", intendedRiskBudget: "50",
    actualNetRisk: "49.5", actualRiskFraction: 0.00495, cashCapped: false, netRiskReward: 1.98,
    warnings: [],
    ...overrides,
  };
}

describe("tradeLedgerToCsv", () => {
  it("emits a header row followed by one row per trade", () => {
    const csv = tradeLedgerToCsv([trade()]);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("entryTime");
    expect(lines[0]).toContain("realizedPnl");
  });

  it("returns just the header row for an empty ledger", () => {
    const csv = tradeLedgerToCsv([]);
    expect(csv.trim().split("\n").length).toBe(1);
  });

  it("quotes a field that contains a comma (e.g. a joined warnings list)", () => {
    const csv = tradeLedgerToCsv([trade({ warnings: ["a, b", "c"] })]);
    expect(csv).toContain('"a, b; c"');
  });

  it("quotes and doubles internal quote characters", () => {
    const csv = tradeLedgerToCsv([trade({ warnings: ['say "hi"'] })]);
    expect(csv).toContain('"say ""hi"""');
  });

  it("quotes a field containing a bare CR as well as LF", () => {
    const csv = tradeLedgerToCsv([trade({ warnings: ["line1\rline2"] })]);
    const rows = csv.split("\n");
    // the CR-containing field must be wrapped in quotes, not left bare
    expect(rows.some((r) => r.includes('"line1\rline2"'))).toBe(true);
  });

  describe("spreadsheet formula-injection protection", () => {
    it.each([
      ["=", "=1+1"],
      ["+", "+1+1"],
      ["-", "-2+3"],
      ["@", "@SUM(A1:A2)"],
      ["tab", "\tcmd"],
      ["carriage return", "\rcmd"],
    ])("neutralizes a warnings cell beginning with %s by prefixing a single quote", (_label, payload) => {
      const csv = tradeLedgerToCsv([trade({ warnings: [payload] })]);
      const dataLine = csv.split("\n")[1]!;
      // The raw formula-triggering prefix must never appear as the first character
      // of the serialized cell — a leading ' neutralizes it in every major spreadsheet app.
      expect(dataLine.startsWith(payload[0]!)).toBe(false);
      expect(dataLine).toContain(`'${payload}`.replace(/"/g, '""'));
    });

    it("also neutralizes a legitimate negative numeric field (realizedPnl) — CSV has no per-column type, so the rule applies uniformly", () => {
      const csv = tradeLedgerToCsv([trade({ realizedPnl: "-9.79" })]);
      const dataLine = csv.split("\n")[1]!;
      expect(dataLine).toContain("'-9.79");
    });

    it("leaves a field with no dangerous prefix untouched", () => {
      const csv = tradeLedgerToCsv([trade({ realizedPnl: "9.79" })]);
      const dataLine = csv.split("\n")[1]!;
      expect(dataLine).toContain(",9.79,");
    });
  });
});
