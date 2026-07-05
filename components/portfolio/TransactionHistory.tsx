"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingBlock, EmptyBlock, ErrorBlock, Modal } from "./ui";
import { portfolioApi, ApiError } from "@/lib/portfolio-client/api";
import {
  formatQuantity,
  formatNative,
  formatDateTime,
} from "@/lib/portfolio-client/format";
import type { TransactionDTO } from "@/lib/portfolio-client/types";

const PAGE = 25;

const TYPE_STYLE: Record<TransactionDTO["type"], string> = {
  BUY: "bg-success/15 text-success",
  SELL: "bg-danger/15 text-danger",
  DIVIDEND: "bg-primary/15 text-primary",
  FEE: "bg-white/5 text-muted-foreground",
};

/**
 * Paged (cursor-based) ledger. Owns its own pagination state (accumulates pages),
 * so it doesn't use the single-shot useAsyncData hook. `refreshKey` bump resets it
 * after a create/edit/delete elsewhere.
 */
export function TransactionHistory({
  portfolioId,
  refreshKey,
  onAdd,
  onEdit,
  onChanged,
}: {
  portfolioId: string;
  refreshKey: number;
  onAdd: () => void;
  onEdit: (tx: TransactionDTO) => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<TransactionDTO[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error>();
  const [pendingDelete, setPendingDelete] = useState<TransactionDTO | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const loadFirst = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setError(undefined);
      portfolioApi.transactions(portfolioId, { limit: PAGE }, signal).then(
        (res) => {
          setItems(res.transactions);
          setCursor(res.nextCursor);
          setLoading(false);
        },
        (e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof Error ? e : new Error(String(e)));
          setLoading(false);
        },
      );
    },
    [portfolioId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    loadFirst(ctrl.signal);
    return () => ctrl.abort();
  }, [loadFirst, refreshKey]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await portfolioApi.transactions(portfolioId, {
        limit: PAGE,
        cursor,
      });
      setItems((prev) => [...prev, ...res.transactions]);
      setCursor(res.nextCursor);
    } catch {
      /* keep existing page; a transient error shouldn't wipe the list */
    } finally {
      setLoadingMore(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await portfolioApi.deleteTransaction(portfolioId, pendingDelete.id);
      setPendingDelete(undefined);
      onChanged();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "ลบไม่สำเร็จ ลองใหม่อีกครั้ง",
      );
    } finally {
      setDeleting(false);
    }
  }

  const addButton = (
    <button
      type="button"
      onClick={onAdd}
      className="inline-flex items-center gap-1 rounded-sm bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Plus className="h-3 w-3" aria-hidden /> เพิ่มรายการ
    </button>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">{addButton}</div>

      {loading ? (
        <LoadingBlock label="กำลังโหลดประวัติรายการ…" rows={4} />
      ) : error ? (
        <ErrorBlock error={error} onRetry={() => loadFirst()} />
      ) : items.length === 0 ? (
        <EmptyBlock
          title="ยังไม่มีรายการซื้อขาย"
          hint="เพิ่มรายการแรกเพื่อเริ่มติดตามพอร์ตของคุณ"
          action={addButton}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">ประวัติรายการซื้อขาย</caption>
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-medium">วันที่</th>
                  <th scope="col" className="py-1.5 px-3 font-medium">สินทรัพย์</th>
                  <th scope="col" className="py-1.5 px-3 font-medium">ประเภท</th>
                  <th scope="col" className="py-1.5 px-3 text-right font-medium">จำนวน</th>
                  <th scope="col" className="py-1.5 px-3 text-right font-medium">ราคา</th>
                  <th scope="col" className="py-1.5 px-3 text-right font-medium">FX</th>
                  <th scope="col" className="py-1.5 pl-3 text-right font-medium">
                    <span className="sr-only">การกระทำ</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="border-t border-border/40">
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                      {formatDateTime(t.executedAt)}
                    </td>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="font-semibold">{t.assetSymbol}</span>
                    </th>
                    <td className="px-3 py-2">
                      <span className={cn("rounded-sm px-1.5 py-0.5 text-[10px]", TYPE_STYLE[t.type])}>
                        {t.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatQuantity(t.quantity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNative(t.executedPrice, t.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {Number(t.fxRateUsdThb).toFixed(2)}
                    </td>
                    <td className="py-2 pl-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit(t)}
                          aria-label={`แก้ไขรายการ ${t.assetSymbol}`}
                          className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-white/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(t)}
                          aria-label={`ลบรายการ ${t.assetSymbol}`}
                          className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-destructive/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cursor ? (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
              >
                {loadingMore ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                โหลดเพิ่ม
              </button>
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(undefined)}
        title="ยืนยันการลบ"
        accent="#ef4444"
      >
        <p className="text-xs text-foreground">
          ลบรายการ{" "}
          <span className="font-semibold">
            {pendingDelete?.type} {pendingDelete?.assetSymbol}
          </span>{" "}
          จำนวน {pendingDelete ? formatQuantity(pendingDelete.quantity) : ""} ?
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          การลบจะคำนวณต้นทุน/holding ของสินทรัพย์นี้ใหม่ทันที และย้อนกลับไม่ได้
        </p>
        {deleteError ? (
          <p role="alert" className="mt-2 rounded-sm bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
            {deleteError}
          </p>
        ) : null}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setPendingDelete(undefined)}
            className="rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-sm bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:opacity-60"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            ลบรายการ
          </button>
        </div>
      </Modal>
    </div>
  );
}
