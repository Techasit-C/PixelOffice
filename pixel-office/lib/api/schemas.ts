// Zod request schemas. All money/quantity fields arrive as STRINGS (or numbers,
// coerced to string) and are validated as parseable non-negative Decimals — the
// wire never carries a computed float. Enums mirror the final Prisma schema.
import { Prisma } from "@prisma/client";
import { z } from "zod";

// A money/quantity value: accept string or number, keep as string, must parse as a
// finite, non-negative Decimal. Rejects NaN/Infinity/negative/garbage AND values
// that exceed the target DB column's precision/scale — so over-precision fails as a
// 400 here (CR-003 F-03) instead of a Postgres "numeric field overflow" 500.
//
// Decimal(precision, scale): `precision` = total significant digits, `scale` =
// digits after the point. Max integer digits = precision - scale. We bound BOTH:
// integer-digit count (overflow -> DB error) and scale (silent DB rounding, which
// would corrupt money/quantity).
export function boundedDecimalString(precision: number, scale: number) {
  const maxIntDigits = precision - scale;
  return z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v.toString() : v.trim()))
    .refine((s) => s.length > 0, "required")
    .superRefine((s, ctx) => {
      let d: Prisma.Decimal;
      try {
        d = new Prisma.Decimal(s);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "not a valid number" });
        return;
      }
      if (!d.isFinite()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be finite" });
        return;
      }
      if (d.isNegative()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be >= 0" });
      }
      // decimal.js strips trailing zeros, so decimalPlaces() is the true scale.
      const usedScale = d.decimalPlaces();
      if (usedScale > scale) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `too many decimal places (max ${scale})`,
        });
      }
      // Integer digits: 0 for |value| < 1, else the length of the integer part.
      const intPart = d.abs().trunc();
      const intDigits = intPart.isZero() ? 0 : intPart.toFixed(0).length;
      if (intDigits > maxIntDigits) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `value too large (max ${maxIntDigits} integer digits)`,
        });
      }
    });
}

// Per-field bounds mirror the exact Prisma column types (schema.prisma):
//   quantity       Decimal(30,10)   Transaction.quantity
//   executedPrice  Decimal(20,8)    Transaction.executedPrice
//   fxRateUsdThb   Decimal(18,8)    Transaction.fxRateUsdThb
//   fees           Decimal(20,8)    Transaction.fees
export const quantityDecimal = boundedDecimalString(30, 10);
export const priceDecimal = boundedDecimalString(20, 8);
export const fxRateDecimal = boundedDecimalString(18, 8);
const feesDecimal = boundedDecimalString(20, 8);
// THB money aggregates land in Decimal(20,2) columns (snapshots); exported for reuse.
export const thbMoneyDecimal = boundedDecimalString(20, 2);

const assetType = z.enum(["EQUITY", "ETF", "CRYPTO"]);
const transactionType = z.enum(["BUY", "SELL", "DIVIDEND", "FEE"]);
const costBasisMethod = z.enum(["AVERAGE_COST", "FIFO", "LIFO", "SPECIFIC_LOT"]);

export const createPortfolioSchema = z.object({
  name: z.string().min(1).max(120),
  baseCurrency: z.string().min(3).max(8).optional(),
  costBasisMethod: costBasisMethod.optional(),
});

export const updatePortfolioSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    costBasisMethod: costBasisMethod.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "no fields to update");

export const createTransactionSchema = z.object({
  assetSymbol: z.string().min(1).max(20),
  assetType,
  type: transactionType,
  quantity: quantityDecimal,
  executedPrice: priceDecimal,
  currency: z.string().min(3).max(8).default("USD"),
  // Optional: if omitted, the handler snapshots the current live rate.
  fxRateUsdThb: fxRateDecimal.optional(),
  fees: feesDecimal.optional(),
  executedAt: z.coerce.date(),
  source: z.string().max(40).optional(),
  externalId: z.string().max(120).optional(),
  assetName: z.string().max(120).optional(),
});

export const updateTransactionSchema = createTransactionSchema
  .partial()
  .refine((o) => Object.keys(o).length > 0, "no fields to update");

// Performance-history query (CR-004). All optional. `from`/`to` are ISO dates;
// `limit` caps returned points (guards an unbounded scan of a long history).
export const performanceQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().positive().max(5000).optional(),
  })
  .refine(
    (o) => !(o.from && o.to) || o.from <= o.to,
    "`from` must be on or before `to`",
  );

export type PerformanceQuery = z.infer<typeof performanceQuerySchema>;

export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>;
export type UpdatePortfolioInput = z.infer<typeof updatePortfolioSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
