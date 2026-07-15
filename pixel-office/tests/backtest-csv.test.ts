import { describe, it, expect } from "vitest";
import { tradeLedgerToCsv, CsvExportError, CSV_COLUMNS } from "@/lib/backtest/csv";
import type { TradeLedgerEntry } from "@/lib/backtest/types";

function trade(overrides: Partial<TradeLedgerEntry> = {}): TradeLedgerEntry {
  return {
    entryTime: 1000, entryPrice: "100.00000000", quantity: "1.00000000",
    entryNotional: "100.00000000", entryFee: "0.10000000", entryCost: "100.10000000",
    exitTime: 2000, exitPrice: "110.00000000", exitReason: "TP1",
    exitNotional: "110.00000000", exitFee: "0.11000000", exitProceeds: "109.89000000",
    realizedPnl: "9.79000000", intendedRiskBudget: "50.00000000",
    actualNetRisk: "49.50000000", actualRiskFraction: 0.00495, cashCapped: false,
    netRiskReward: 1.98,
    warnings: [],
    ...overrides,
  };
}

function dataRow(csv: string): string[] {
  const line = csv.split("\n")[1]!;
  return line.split(",");
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

  it("every row (header and data) has exactly CSV_COLUMNS.length fields", () => {
    const csv = tradeLedgerToCsv([trade(), trade({ realizedPnl: "-9.79000000" })]);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(3);
    for (const line of lines) {
      // Naive split is safe here: none of these fixtures contain embedded commas.
      expect(line.split(",").length).toBe(CSV_COLUMNS.length);
    }
  });

  describe("monetary/quantity columns stay valid fixed-point numbers, never neutralized", () => {
    it("a negative realizedPnl is exported as a plain numeric value, not quote-prefixed", () => {
      const csv = tradeLedgerToCsv([trade({ realizedPnl: "-9.79000000" })]);
      const row = dataRow(csv);
      const idx = CSV_COLUMNS.indexOf("realizedPnl");
      expect(row[idx]).toBe("-9.79000000");
    });

    it("a positive monetary value is exported unquoted and unmodified", () => {
      const csv = tradeLedgerToCsv([trade({ entryPrice: "12345.67890000" })]);
      const row = dataRow(csv);
      const idx = CSV_COLUMNS.indexOf("entryPrice");
      expect(row[idx]).toBe("12345.67890000");
    });

    it("a zero monetary value is exported unquoted and unmodified", () => {
      const csv = tradeLedgerToCsv([trade({ entryFee: "0.00000000" })]);
      const row = dataRow(csv);
      const idx = CSV_COLUMNS.indexOf("entryFee");
      expect(row[idx]).toBe("0.00000000");
    });

    it("rejects a malformed monetary value instead of silently exporting it", () => {
      expect(() => tradeLedgerToCsv([trade({ realizedPnl: "=1+1" })])).toThrow(CsvExportError);
      expect(() => tradeLedgerToCsv([trade({ entryPrice: "not-a-number" })])).toThrow(CsvExportError);
      expect(() => tradeLedgerToCsv([trade({ quantity: "1.5e10" })])).toThrow(CsvExportError);
      expect(() => tradeLedgerToCsv([trade({ entryNotional: "100.5" })])).toThrow(CsvExportError); // wrong dp count
    });
  });

  describe("timestamp columns stay numeric", () => {
    it("entryTime/exitTime are exported as plain integers", () => {
      const csv = tradeLedgerToCsv([trade({ entryTime: 1_700_000_000_000, exitTime: 1_700_000_100_000 })]);
      const row = dataRow(csv);
      expect(row[CSV_COLUMNS.indexOf("entryTime")]).toBe("1700000000000");
      expect(row[CSV_COLUMNS.indexOf("exitTime")]).toBe("1700000100000");
    });

    it("rejects a non-integer or negative timestamp", () => {
      expect(() => tradeLedgerToCsv([trade({ entryTime: 1.5 })])).toThrow(CsvExportError);
      expect(() => tradeLedgerToCsv([trade({ entryTime: -1 })])).toThrow(CsvExportError);
    });
  });

  describe("numeric-fraction and boolean columns", () => {
    it("actualRiskFraction and netRiskReward are exported as plain numbers", () => {
      const csv = tradeLedgerToCsv([trade({ actualRiskFraction: -0.005, netRiskReward: 2.5 })]);
      const row = dataRow(csv);
      expect(row[CSV_COLUMNS.indexOf("actualRiskFraction")]).toBe("-0.005");
      expect(row[CSV_COLUMNS.indexOf("netRiskReward")]).toBe("2.5");
    });

    it("cashCapped is exported as a plain boolean literal", () => {
      const csv = tradeLedgerToCsv([trade({ cashCapped: true })]);
      const row = dataRow(csv);
      expect(row[CSV_COLUMNS.indexOf("cashCapped")]).toBe("true");
    });
  });

  describe("textual columns: escaping and formula-injection protection", () => {
    it("quotes a warnings field that contains a comma", () => {
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
      expect(rows.some((r) => r.includes('"line1\rline2"'))).toBe(true);
    });

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
      expect(dataLine.startsWith(payload[0]!)).toBe(false);
      expect(dataLine).toContain(`'${payload}`.replace(/"/g, '""'));
    });

    it("leaves a warnings field with no dangerous prefix untouched (aside from CSV syntax escaping)", () => {
      const csv = tradeLedgerToCsv([trade({ warnings: ["cash-capped entry"] })]);
      const row = dataRow(csv);
      expect(row[CSV_COLUMNS.indexOf("warnings")]).toBe("cash-capped entry");
    });

    it("exitReason (a closed enum) round-trips exactly for every legal value", () => {
      for (const reason of ["STOP", "TP1", "END_OF_TEST"] as const) {
        const csv = tradeLedgerToCsv([trade({ exitReason: reason })]);
        const row = dataRow(csv);
        expect(row[CSV_COLUMNS.indexOf("exitReason")]).toBe(reason);
      }
    });
  });
});
