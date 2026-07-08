"use client";

import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { PixelCard, SourceTag, StatLine } from "@/components/ui/PixelCard";
import { useJsonPoll } from "@/lib/use-json-poll";
import { signColor } from "@/lib/utils";
import type { PortfolioListResponse } from "@/lib/portfolio-client/types";
import type { AgentsResponse } from "@/types/agent";
import type { Quote } from "@/types/market";

const ACCENT = "#3b82f6";
const DCA_TARGET = 1_000_000; // ฿ — mandate goal

interface CompanyStatus {
  realizedPnl: number;
  totalPnl: number;
  netCashflow: number;
  holdingsBtc: number;
  holdingsUsdt: number;
  apy: number;
  safeWithdraw: number;
  updatedAt: string;
  holdingsSource?: "live" | "mock";
}
interface Affiliate {
  todayThb: number;
  todayUsd: number;
  fxRate: number;
  source?: "live" | "mock";
}
interface CryptoResponse {
  quotes: Quote[];
  source?: "coingecko" | "mock";
}

const thb = (n: number) =>
  `฿${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** One headline KPI, pixel-framed. */
function KpiCard({
  title,
  accent,
  value,
  valueClassName,
  sub,
  source,
  loading,
  error,
}: {
  title: string;
  accent: string;
  value: string;
  valueClassName?: string;
  sub?: string;
  source?: string;
  loading?: boolean;
  error?: string;
  }) {
  return (
    <PixelCard title={title} accent={accent} right={<SourceTag source={source} />}>
      {loading ? (
        <div className="h-7 w-24 animate-pulse rounded bg-white/5" />
      ) : error ? (
        <div className="text-[11px] text-danger" role="alert">
          โหลดไม่สำเร็จ
          <div className="text-muted-foreground/70">{error}</div>
        </div>
      ) : (
        <>
          <div className={`text-xl font-semibold tabular-nums ${valueClassName ?? ""}`}>
            {value}
          </div>
          {sub ? (
            <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
          ) : null}
        </>
      )}
    </PixelCard>
  );
}

export default function ExecutiveDashboardClient() {
  const portfolios = useJsonPoll<PortfolioListResponse>("/api/portfolios", 45_000);
  const company = useJsonPoll<CompanyStatus>("/api/company-status", 45_000);
  const affiliate = useJsonPoll<Affiliate>("/api/affiliate", 60_000);
  const crypto = useJsonPoll<CryptoResponse>("/api/crypto-prices", 45_000);
  const agents = useJsonPoll<AgentsResponse>("/api/agents", 30_000);

  const pf = useMemo(() => {
    const list = portfolios.data?.portfolios ?? [];
    const totalValue = list.reduce(
      (s, p) => s + Number(p.currentValueBase || 0),
      0,
    );
    const unrealized = list.reduce(
      (s, p) => s + Number(p.unrealizedPnlBase || 0),
      0,
    );
    const dcaPct = (totalValue / DCA_TARGET) * 100;
    return { count: list.length, totalValue, unrealized, dcaPct };
  }, [portfolios.data]);

  const btc = useMemo(() => {
    const q = crypto.data?.quotes?.find((x) => x.symbol.toUpperCase() === "BTC");
    const price = q?.price ?? 0;
    const holdings = company.data?.holdingsBtc ?? 0;
    return { price, holdings, valueUsd: price * holdings };
  }, [crypto.data, company.data]);

  const workforce = useMemo(() => {
    const teams = agents.data?.teams ?? [];
    const all = teams.flatMap((t) => t.agents);
    const perTeam = teams.map((t) => ({
      label: t.label,
      count: t.agents.length,
    }));
    const errors = all.filter((a) => a.status === "error").length;
    return { total: all.length, perTeam, errors };
  }, [agents.data]);

  function refetchAll() {
    portfolios.refetch();
    company.refetch();
    affiliate.refetch();
    crypto.refetch();
    agents.refetch();
  }

  return (
    <PageShell accent={ACCENT}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-pixel text-xs tracking-wide text-primary">
            EXECUTIVE DASHBOARD
          </h1>
          <p className="mt-1 text-[11px] text-muted-foreground">
            ภาพรวมบริษัท — พอร์ต, PnL, รายได้ affiliate, สินทรัพย์คริปโต และกำลังพล AI
          </p>
        </div>
        <button
          type="button"
          onClick={refetchAll}
          aria-label="รีเฟรชข้อมูล"
          className="grid h-8 w-8 place-items-center rounded-sm border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="มูลค่าพอร์ตรวม"
          accent="#22c55e"
          loading={portfolios.loading && !portfolios.data}
          error={portfolios.error}
          value={thb(pf.totalValue)}
          sub={`${pf.count} พอร์ต`}
        />
        <KpiCard
          title="กำไร/ขาดทุนยังไม่รับรู้"
          accent={pf.unrealized >= 0 ? "#22c55e" : "#ef4444"}
          loading={portfolios.loading && !portfolios.data}
          error={portfolios.error}
          value={thb(pf.unrealized)}
          valueClassName={signColor(pf.unrealized)}
          sub="unrealized PnL (base THB)"
        />
        <KpiCard
          title="DCA สู่ ฿1,000,000"
          accent="#22c55e"
          loading={portfolios.loading && !portfolios.data}
          error={portfolios.error}
          value={`${pf.dcaPct.toFixed(1)}%`}
          sub={`${thb(pf.totalValue)} / ${thb(DCA_TARGET)}`}
        />
        <KpiCard
          title="รายได้ AFFILIATE วันนี้"
          accent="#f2c14e"
          source={affiliate.data?.source}
          loading={affiliate.loading && !affiliate.data}
          error={affiliate.error}
          value={thb(affiliate.data?.todayThb ?? 0)}
          sub={affiliate.data ? `${usd(affiliate.data.todayUsd)} · FX ${affiliate.data.fxRate.toFixed(2)}` : undefined}
        />
      </div>

      {/* Second row: company status + crypto + workforce */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PixelCard
          title="COMPANY STATUS"
          accent="#3b82f6"
          right={<SourceTag source={company.data?.holdingsSource} />}
        >
          {company.loading && !company.data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-5 animate-pulse rounded bg-white/5" />
              ))}
            </div>
          ) : company.error ? (
            <div className="text-[11px] text-danger" role="alert">
              โหลดไม่สำเร็จ · {company.error}
            </div>
          ) : company.data ? (
            <div>
              <StatLine
                label="กำไร/ขาดทุนรวม"
                value={usd(company.data.totalPnl)}
                valueClassName={signColor(company.data.totalPnl)}
              />
              <StatLine
                label="Realized PnL"
                value={usd(company.data.realizedPnl)}
                valueClassName={signColor(company.data.realizedPnl)}
              />
              <StatLine label="Net cashflow" value={usd(company.data.netCashflow)} />
              <StatLine label="APY" value={`${company.data.apy.toFixed(1)}%`} />
              <StatLine
                label="Holdings"
                value={`${company.data.holdingsBtc.toFixed(4)} BTC · ${usd(company.data.holdingsUsdt)}`}
              />
              <div className="mt-2 text-[10px] text-muted-foreground/70">
                อัปเดต {company.data.updatedAt} · PnL/APY/cashflow เป็นค่าจำลอง (mock)
              </div>
            </div>
          ) : null}
        </PixelCard>

        <PixelCard
          title="สินทรัพย์คริปโต (BTC)"
          accent="#22d3ee"
          right={<SourceTag source={crypto.data?.source} />}
        >
          {crypto.loading && !crypto.data ? (
            <div className="h-16 animate-pulse rounded bg-white/5" />
          ) : crypto.error ? (
            <div className="text-[11px] text-danger" role="alert">
              โหลดไม่สำเร็จ · {crypto.error}
            </div>
          ) : (
            <div>
              <div className="text-xl font-semibold tabular-nums">
                {usd(btc.valueUsd)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {btc.holdings.toFixed(4)} BTC × {usd(btc.price)}
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground/70">
                holdings จาก company-status · ราคาจาก crypto-prices
              </div>
            </div>
          )}
        </PixelCard>

        <PixelCard title="กำลังพล AI (WORKFORCE)" accent="#a78bfa">
          {agents.loading && !agents.data ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-5 animate-pulse rounded bg-white/5" />
              ))}
            </div>
          ) : agents.error ? (
            <div className="text-[11px] text-danger" role="alert">
              โหลดไม่สำเร็จ · {agents.error}
            </div>
          ) : workforce.total === 0 ? (
            <div className="text-[11px] text-muted-foreground">
              ไม่พบไฟล์ agent บนเครื่องนี้
            </div>
          ) : (
            <div>
              <div className="text-xl font-semibold tabular-nums">
                {workforce.total} agents
              </div>
              <div className="mt-2 space-y-0.5">
                {workforce.perTeam.map((t) => (
                  <StatLine key={t.label} label={t.label} value={String(t.count)} />
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground/70">
                <span>
                  {workforce.errors > 0 ? (
                    <span className="text-danger">{workforce.errors} error</span>
                  ) : (
                    "ไม่มี error"
                  )}
                </span>
                <span>ติดตั้งไว้ — ไม่ได้กำลังรัน</span>
              </div>
            </div>
          )}
        </PixelCard>
      </div>
    </PageShell>
  );
}
