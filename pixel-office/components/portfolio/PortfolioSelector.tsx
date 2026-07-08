"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { Modal } from "./ui";
import { portfolioApi, ApiError } from "@/lib/portfolio-client/api";
import type { PortfolioSummary } from "@/lib/portfolio-client/types";

export function PortfolioSelector({
  portfolios,
  selectedId,
  onSelect,
  onCreated,
}: {
  portfolios: PortfolioSummary[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await portfolioApi.create({ name: name.trim(), baseCurrency: "THB" });
      setCreating(false);
      setName("");
      onCreated(res.portfolio.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "สร้างพอร์ตไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="portfolio-select" className="text-[11px] text-muted-foreground">
        พอร์ต
      </label>
      <select
        id="portfolio-select"
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded-sm border border-border bg-black/30 px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {portfolios.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.baseCurrency})
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1.5 text-[11px] text-foreground hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Plus className="h-3 w-3" aria-hidden /> พอร์ตใหม่
      </button>

      <Modal open={creating} onClose={() => setCreating(false)} title="สร้างพอร์ตใหม่">
        <form onSubmit={handleCreate} className="space-y-3" noValidate>
          {error ? (
            <p role="alert" className="rounded-sm bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
              {error}
            </p>
          ) : null}
          <label className="block" htmlFor="new-portfolio-name">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
              ชื่อพอร์ต
            </span>
            <input
              id="new-portfolio-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="off"
              placeholder="DCA ระยะยาว"
              className="w-full rounded-sm border border-border bg-black/30 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              สร้างพอร์ต
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
