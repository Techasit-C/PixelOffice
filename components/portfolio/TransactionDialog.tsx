"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "./ui";
import { portfolioApi, ApiError } from "@/lib/portfolio-client/api";
import { toDateInputValue } from "@/lib/portfolio-client/format";
import type {
  TransactionDTO,
  CreateTransactionBody,
  UpdateTransactionBody,
  AssetType,
  TransactionType,
} from "@/lib/portfolio-client/types";

const ASSET_TYPES: AssetType[] = ["EQUITY", "ETF", "CRYPTO"];
const TX_TYPES: TransactionType[] = ["BUY", "SELL", "DIVIDEND", "FEE"];

interface FormState {
  assetSymbol: string;
  assetType: AssetType;
  type: TransactionType;
  quantity: string;
  executedPrice: string;
  currency: string;
  fxRateUsdThb: string;
  fees: string;
  executedAt: string; // yyyy-mm-dd
}

function initial(tx?: TransactionDTO): FormState {
  return {
    assetSymbol: tx?.assetSymbol ?? "",
    assetType: tx?.assetType ?? "ETF",
    type: tx?.type ?? "BUY",
    quantity: tx?.quantity ?? "",
    executedPrice: tx?.executedPrice ?? "",
    currency: tx?.currency ?? "USD",
    fxRateUsdThb: tx?.fxRateUsdThb ?? "",
    fees: tx?.fees ?? "",
    executedAt: tx ? toDateInputValue(tx.executedAt) : toDateInputValue(new Date().toISOString()),
  };
}

export function TransactionDialog({
  open,
  onClose,
  portfolioId,
  tx,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  portfolioId: string;
  tx?: TransactionDTO; // present => edit mode
  onSaved: () => void;
}) {
  const editing = !!tx;
  const [form, setForm] = useState<FormState>(() => initial(tx));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  // Re-seed when the target tx changes (dialog reused across rows).
  const [seededFor, setSeededFor] = useState<string | undefined>(tx?.id);
  if (open && seededFor !== tx?.id) {
    setSeededFor(tx?.id);
    setForm(initial(tx));
    setFormError(undefined);
    setFieldErrors({});
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(undefined);
    setFieldErrors({});

    const executedAtIso = form.executedAt
      ? new Date(form.executedAt).toISOString()
      : new Date().toISOString();

    try {
      if (editing && tx) {
        const body: UpdateTransactionBody = {
          type: form.type,
          quantity: form.quantity,
          executedPrice: form.executedPrice,
          currency: form.currency,
          executedAt: executedAtIso,
          ...(form.fxRateUsdThb ? { fxRateUsdThb: form.fxRateUsdThb } : {}),
          ...(form.fees ? { fees: form.fees } : {}),
        };
        await portfolioApi.updateTransaction(portfolioId, tx.id, body);
      } else {
        const body: CreateTransactionBody = {
          assetSymbol: form.assetSymbol.trim().toUpperCase(),
          assetType: form.assetType,
          type: form.type,
          quantity: form.quantity,
          executedPrice: form.executedPrice,
          currency: form.currency,
          executedAt: executedAtIso,
          ...(form.fxRateUsdThb ? { fxRateUsdThb: form.fxRateUsdThb } : {}),
          ...(form.fees ? { fees: form.fees } : {}),
        };
        await portfolioApi.createTransaction(portfolioId, body);
      }
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        if (err.fieldErrors) setFieldErrors(err.fieldErrors);
      } else {
        setFormError("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "แก้ไขรายการ" : "เพิ่มรายการซื้อขาย"}
      accent="#3b82f6"
    >
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        {formError ? (
          <p role="alert" className="rounded-sm bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
            {formError}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="สัญลักษณ์ (Symbol)" error={fieldErrors.assetSymbol}>
            <input
              className={inputCls}
              value={form.assetSymbol}
              onChange={(e) => set("assetSymbol", e.target.value)}
              disabled={editing}
              required={!editing}
              placeholder="VOO"
              autoComplete="off"
            />
          </Field>
          <Field label="ประเภทสินทรัพย์" error={fieldErrors.assetType}>
            <select
              className={inputCls}
              value={form.assetType}
              onChange={(e) => set("assetType", e.target.value as AssetType)}
              disabled={editing}
            >
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="ประเภทรายการ" error={fieldErrors.type}>
            <select
              className={inputCls}
              value={form.type}
              onChange={(e) => set("type", e.target.value as TransactionType)}
            >
              {TX_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="วันที่ทำรายการ" error={fieldErrors.executedAt}>
            <input
              type="date"
              className={inputCls}
              value={form.executedAt}
              onChange={(e) => set("executedAt", e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="จำนวน (Quantity)" error={fieldErrors.quantity}>
            <input
              className={inputCls}
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              inputMode="decimal"
              required
              placeholder="10"
            />
          </Field>
          <Field label="ราคาต่อหน่วย" error={fieldErrors.executedPrice}>
            <input
              className={inputCls}
              value={form.executedPrice}
              onChange={(e) => set("executedPrice", e.target.value)}
              inputMode="decimal"
              required
              placeholder="450.25"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="สกุลเงิน" error={fieldErrors.currency}>
            <input
              className={inputCls}
              value={form.currency}
              onChange={(e) => set("currency", e.target.value.toUpperCase())}
              required
              placeholder="USD"
            />
          </Field>
          <Field label="FX USD→THB" error={fieldErrors.fxRateUsdThb} hint="เว้นว่าง = ใช้เรตสด">
            <input
              className={inputCls}
              value={form.fxRateUsdThb}
              onChange={(e) => set("fxRateUsdThb", e.target.value)}
              inputMode="decimal"
              placeholder="33.0"
            />
          </Field>
          <Field label="ค่าธรรมเนียม" error={fieldErrors.fees}>
            <input
              className={inputCls}
              value={form.fees}
              onChange={(e) => set("fees", e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-border px-3 py-1.5 text-xs text-foreground hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {editing ? "บันทึกการแก้ไข" : "เพิ่มรายการ"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputCls =
  "w-full rounded-sm border border-border bg-black/30 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary";

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  const id = label;
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {/* clone target: children already carry their own props; wrap for id assoc */}
      <span className="block">{children}</span>
      {hint && !error ? (
        <span className="mt-0.5 block text-[10px] text-muted-foreground/70">{hint}</span>
      ) : null}
      {error?.length ? (
        <span className={cn("mt-0.5 block text-[10px] text-danger")}>{error.join(", ")}</span>
      ) : null}
    </label>
  );
}
