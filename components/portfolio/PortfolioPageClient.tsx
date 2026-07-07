"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import {
  usePortfolios,
  useValuation,
  useAllocation,
  useMilestones,
} from "@/lib/portfolio-client/hooks";
import { Panel, SourceBadge, LoadingBlock, EmptyBlock, ErrorBlock } from "./ui";
import { HeaderAuth } from "@/components/auth/HeaderAuth";
import { PortfolioSelector } from "./PortfolioSelector";
import { PortfolioSummary } from "./PortfolioSummary";
import { HoldingsTable } from "./HoldingsTable";
import { AllocationDonut } from "./AllocationDonut";
import { PerformanceChart } from "./PerformanceChart";
import { MilestoneProgress } from "./MilestoneProgress";
import { TransactionHistory } from "./TransactionHistory";
import { TransactionDialog } from "./TransactionDialog";
import type { TransactionDTO } from "@/lib/portfolio-client/types";

export default function PortfolioPageClient() {
  const portfoliosState = usePortfolios();
  const portfolios = useMemo(
    () => portfoliosState.data?.portfolios ?? [],
    [portfoliosState.data],
  );

  const [selectedId, setSelectedId] = useState<string>();
  const [txRefreshKey, setTxRefreshKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [editTx, setEditTx] = useState<TransactionDTO>();

  // Default selection to the first portfolio once loaded / keep valid on changes.
  useEffect(() => {
    if (portfolios.length === 0) return;
    if (!selectedId || !portfolios.some((p) => p.id === selectedId)) {
      setSelectedId(portfolios[0].id);
    }
  }, [portfolios, selectedId]);

  const valuation = useValuation(selectedId);
  const allocation = useAllocation(selectedId);
  const milestones = useMilestones(selectedId);

  const source = valuation.data?.source;

  function refetchAll() {
    portfoliosState.refetch();
    valuation.refetch();
    allocation.refetch();
    milestones.refetch();
    setTxRefreshKey((k) => k + 1);
  }

  // A ledger mutation changes valuation/allocation/milestones + the list summary.
  function onLedgerChanged() {
    portfoliosState.refetch();
    valuation.refetch();
    allocation.refetch();
    milestones.refetch();
    setTxRefreshKey((k) => k + 1);
  }

  const holdings = valuation.data?.holdings ?? [];

  const header = useMemo(
    () => (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-white/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden /> ออฟฟิศ
          </Link>
          <h1 className="font-pixel text-xs tracking-wide text-primary">
            PORTFOLIO
          </h1>
          {source ? <SourceBadge source={source} /> : null}
        </div>
        <div className="flex items-center gap-2">
          {portfolios.length > 0 ? (
            <PortfolioSelector
              portfolios={portfolios}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCreated={(id) => {
                portfoliosState.refetch();
                setSelectedId(id);
              }}
            />
          ) : null}
          <button
            type="button"
            onClick={refetchAll}
            aria-label="รีเฟรชข้อมูล"
            className="grid h-8 w-8 place-items-center rounded-sm border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <HeaderAuth />
        </div>
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [portfolios, selectedId, source],
  );

  // ---- top-level gates: portfolios list itself loading/error/empty ----
  if (portfoliosState.loading) {
    return (
      <Shell header={header}>
        <Panel title="กำลังโหลด">
          <LoadingBlock label="กำลังโหลดพอร์ต…" rows={4} />
        </Panel>
      </Shell>
    );
  }

  if (portfoliosState.error) {
    return (
      <Shell header={header}>
        <Panel title="เกิดข้อผิดพลาด" accent="#ef4444">
          <ErrorBlock error={portfoliosState.error} onRetry={portfoliosState.refetch} />
        </Panel>
      </Shell>
    );
  }

  if (portfolios.length === 0) {
    return (
      <Shell header={header}>
        <Panel title="ยังไม่มีพอร์ต">
          <EmptyBlock
            title="ยังไม่มีพอร์ตการลงทุน"
            hint="สร้างพอร์ตแรกเพื่อเริ่มติดตามมูลค่า การจัดสรร และความคืบหน้า DCA สู่ ฿1,000,000"
            action={
              <PortfolioSelectorCreateOnly
                onCreated={(id) => {
                  portfoliosState.refetch();
                  setSelectedId(id);
                }}
              />
            }
          />
        </Panel>
      </Shell>
    );
  }

  return (
    <Shell header={header}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Summary spans full width */}
        <div className="xl:col-span-3">
          <Panel
            title="สรุปพอร์ต"
            right={<SourceBadge source={source} />}
          >
            {valuation.loading ? (
              <LoadingBlock rows={2} />
            ) : valuation.error ? (
              <ErrorBlock error={valuation.error} onRetry={valuation.refetch} />
            ) : valuation.data ? (
              <PortfolioSummary data={valuation.data} />
            ) : null}
          </Panel>
        </div>

        {/* DCA milestone */}
        <div className="xl:col-span-3">
          <Panel title="ความคืบหน้า DCA สู่ ฿1,000,000" accent="#22c55e">
            {milestones.loading ? (
              <LoadingBlock rows={2} />
            ) : milestones.error ? (
              <ErrorBlock error={milestones.error} onRetry={milestones.refetch} />
            ) : milestones.data ? (
              <MilestoneProgress data={milestones.data} />
            ) : null}
          </Panel>
        </div>

        {/* Allocation */}
        <Panel title="การจัดสรรสินทรัพย์" accent="#a78bfa">
          {allocation.loading ? (
            <LoadingBlock rows={4} />
          ) : allocation.error ? (
            <ErrorBlock error={allocation.error} onRetry={allocation.refetch} />
          ) : (allocation.data?.slices.length ?? 0) === 0 ? (
            <EmptyBlock title="ยังไม่มีข้อมูลการจัดสรร" hint="เพิ่มรายการซื้อเพื่อดูสัดส่วน" />
          ) : (
            <AllocationDonut slices={allocation.data!.slices} />
          )}
        </Panel>

        {/* Performance — real portfolio value-over-time from daily snapshots.
            The chart owns its own fetch/loading/error/empty states. */}
        <Panel title="มูลค่าพอร์ตย้อนหลัง" accent="#22d3ee">
          <PerformanceChart portfolioId={selectedId} />
        </Panel>

        {/* Holdings */}
        <Panel
          title="สินทรัพย์ที่ถือครอง"
          right={<SourceBadge source={source} />}
        >
          {valuation.loading ? (
            <LoadingBlock rows={3} />
          ) : valuation.error ? (
            <ErrorBlock error={valuation.error} onRetry={valuation.refetch} />
          ) : holdings.length === 0 ? (
            <EmptyBlock title="ยังไม่มีสินทรัพย์" hint="เพิ่มรายการซื้อขายด้านล่างเพื่อเริ่มต้น" />
          ) : (
            <HoldingsTable holdings={holdings} />
          )}
        </Panel>

        {/* Transactions */}
        <div className="xl:col-span-3">
          <Panel title="ประวัติรายการซื้อขาย" accent="#f2c14e">
            {selectedId ? (
              <TransactionHistory
                portfolioId={selectedId}
                refreshKey={txRefreshKey}
                onAdd={() => {
                  setEditTx(undefined);
                  setAddOpen(true);
                }}
                onEdit={(tx) => setEditTx(tx)}
                onChanged={onLedgerChanged}
              />
            ) : null}
          </Panel>
        </div>
      </div>

      {selectedId ? (
        <>
          <TransactionDialog
            open={addOpen}
            onClose={() => setAddOpen(false)}
            portfolioId={selectedId}
            onSaved={onLedgerChanged}
          />
          <TransactionDialog
            open={!!editTx}
            onClose={() => setEditTx(undefined)}
            portfolioId={selectedId}
            tx={editTx}
            onSaved={onLedgerChanged}
          />
        </>
      ) : null}
    </Shell>
  );
}

function Shell({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto bg-background scrollbar-thin">
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        {header}
        {children}
        <p className="pt-2 text-center text-[10px] text-muted-foreground/70">
          ข้อมูลประกอบการตัดสินใจเท่านั้น ไม่ใช่คำแนะนำการลงทุน · ผู้ใช้ตัดสินใจเอง
        </p>
      </div>
    </div>
  );
}

// Small wrapper so the empty-state can offer "create" without a selector dropdown.
function PortfolioSelectorCreateOnly({
  onCreated,
}: {
  onCreated: (id: string) => void;
}) {
  return (
    <PortfolioSelector
      portfolios={[]}
      selectedId={undefined}
      onSelect={() => {}}
      onCreated={onCreated}
    />
  );
}
