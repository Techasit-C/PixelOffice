"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { PixelCard, SourceTag, StatLine } from "@/components/ui/PixelCard";
import { MockRibbon } from "@/components/ui/MockRibbon";
import { Drawer } from "@/components/ui/Drawer";
import { TVSignalsWidget } from "@/components/widgets/TVSignalsWidget";
import { CryptoPricesWidget } from "@/components/widgets/CryptoPricesWidget";
import { GridBotWidget } from "@/components/widgets/GridBotWidget";
import { TradingWidget } from "@/components/widgets/TradingWidget";
import { AIAgentsWidget } from "@/components/widgets/AIAgentsWidget";
import { HOTSPOT_META, type HotspotId } from "@/components/pixel-office/office-hotspots";
import { useJsonPoll } from "@/lib/use-json-poll";
import {
  makeGridBotData,
  makeTradingData,
  jitter,
  nowClock,
} from "@/lib/mock-data";
import type { TVAlert } from "@/lib/tradingview-alerts";
import type { AgentsResponse } from "@/types/agent";
import type { Quote } from "@/types/market";

// Three.js/R3F touch WebGL + `document` at render time, so this must never be
// part of the server-rendered tree — ssr:false is required (and only legal
// from a Client Component, which this file already is).
const PixelOffice3DScene = dynamic(
  () =>
    import("@/components/pixel-office/PixelOffice3DScene").then(
      (m) => m.PixelOffice3DScene,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] items-center justify-center text-[11px] text-muted-foreground sm:h-[520px]">
        กำลังโหลดฉาก 3D…
      </div>
    ),
  },
);

const ACCENT = "#2962ff";

interface CryptoResponse {
  quotes: Quote[];
  source?: "coingecko" | "mock";
}
interface Affiliate {
  source?: "live" | "mock";
}
interface CompanyStatus {
  holdingsSource?: "live" | "mock";
  updatedAt: string;
}
interface TVResponse {
  alerts: TVAlert[];
}

function HealthRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border/40 py-1.5 text-xs first:border-t-0">
      <span className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            backgroundColor: ok ? "#22c55e" : "#f2c14e",
            boxShadow: ok
              ? "0 0 6px 1px rgba(34,197,94,0.55)"
              : "0 0 6px 1px rgba(242,193,78,0.55)",
          }}
        />
        <span className="text-muted-foreground">{label}</span>
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground/70">{detail}</span>
    </div>
  );
}

export default function MissionControlClient() {
  const tv = useJsonPoll<TVResponse>("/api/tradingview-webhook", 10_000);
  const crypto = useJsonPoll<CryptoResponse>("/api/crypto-prices", 45_000);
  const affiliate = useJsonPoll<Affiliate>("/api/affiliate", 60_000);
  const company = useJsonPoll<CompanyStatus>("/api/company-status", 45_000);
  const agents = useJsonPoll<AgentsResponse>("/api/agents", 30_000);

  // Grid Bot / V2 Trading are MOCK (no exchange API) — tick gently to feel alive,
  // exactly like the office page. Cancelled on unmount.
  const [gridBot, setGridBot] = useState(makeGridBotData());
  const [trading, setTrading] = useState(makeTradingData());
  // Which 3D-office hotspot panel is open (null = none). Set by either a
  // click on the model in PixelOffice3DScene or its keyboard-accessible
  // fallback button list — both call the same setter.
  const [activeHotspot, setActiveHotspot] = useState<HotspotId | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const t = nowClock();
      setGridBot((d) => ({ ...d, gridProfit: jitter(d.gridProfit, 0.02), updatedAt: t }));
      setTrading((d) => ({ ...d, updatedAt: t }));
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const alerts = tv.data?.alerts ?? [];
  const lastAlert = alerts[0];

  const agentErrors = useMemo(
    () =>
      (agents.data?.teams ?? [])
        .flatMap((t) => t.agents)
        .filter((a) => a.status === "error").length,
    [agents.data],
  );

  const cryptoLive = crypto.data?.source === "coingecko";
  const affiliateLive = affiliate.data?.source === "live";
  const holdingsLive = company.data?.holdingsSource === "live";

  return (
    <PageShell accent={ACCENT}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-pixel text-xs tracking-wide" style={{ color: ACCENT }}>
            MISSION CONTROL
          </h1>
          <p className="mt-1 text-[11px] text-muted-foreground">
            สัญญาณสด, สถานะบอท (mock), ชีพจรตลาด และสุขภาพระบบ
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            tv.refetch();
            crypto.refetch();
            affiliate.refetch();
            company.refetch();
            agents.refetch();
          }}
          aria-label="รีเฟรชข้อมูล"
          className="grid h-8 w-8 place-items-center rounded-sm border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Live signals */}
        <PixelCard
          title="LIVE SIGNALS (TV)"
          accent="#2962ff"
          right={
            <span className="text-[10px] text-muted-foreground/70">
              {alerts.length} alert
            </span>
          }
        >
          {tv.loading && !tv.data ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-white/5" />
              ))}
            </div>
          ) : tv.error && !tv.data ? (
            <div className="text-[11px] text-danger" role="alert">
              โหลด alert ไม่สำเร็จ · {tv.error}
            </div>
          ) : (
            <TVSignalsWidget alerts={alerts} />
          )}
        </PixelCard>

        {/* Market pulse */}
        <PixelCard
          title="MARKET PULSE"
          accent="#22d3ee"
          right={<SourceTag source={crypto.data?.source} />}
        >
          {crypto.loading && !crypto.data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-6 animate-pulse rounded bg-white/5" />
              ))}
            </div>
          ) : crypto.error && !crypto.data ? (
            <div className="text-[11px] text-danger" role="alert">
              โหลดราคาไม่สำเร็จ · {crypto.error}
            </div>
          ) : (
            <CryptoPricesWidget
              quotes={crypto.data?.quotes ?? []}
              source={crypto.data?.source}
            />
          )}
        </PixelCard>

        {/* System health */}
        <PixelCard title="SYSTEM HEALTH" accent="#22c55e">
          <HealthRow
            label="Crypto prices"
            ok={cryptoLive}
            detail={crypto.error ? "error" : cryptoLive ? "live" : "mock"}
          />
          <HealthRow
            label="Affiliate feed"
            ok={affiliateLive}
            detail={affiliate.error ? "error" : affiliateLive ? "live" : "mock"}
          />
          <HealthRow
            label="Company holdings"
            ok={holdingsLive}
            detail={company.error ? "error" : holdingsLive ? "live" : "mock"}
          />
          <HealthRow
            label="AI agents"
            ok={!agents.error && agentErrors === 0}
            detail={
              agents.error
                ? "error"
                : agentErrors > 0
                  ? `${agentErrors} error`
                  : "ok"
            }
          />
          <StatLine
            label="TV alert ล่าสุด"
            value={lastAlert ? lastAlert.receivedAt : "ยังไม่มี"}
            valueClassName="text-[10px] text-muted-foreground/70"
          />
          <div className="mt-2 text-[9px] text-muted-foreground/60">
            * สถานะจากธง source/holdingsSource ของแต่ละ endpoint — mock ไม่ถูกแสดงเป็นข้อมูลจริง
          </div>
        </PixelCard>
      </div>

      {/* Bots (mock) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PixelCard title="GRID BOT" accent="#22d3ee">
          <MockRibbon />
          <GridBotWidget data={gridBot} />
        </PixelCard>
        <PixelCard title="V2 TRADING" accent="#3b82f6">
          <MockRibbon />
          <TradingWidget data={trading} />
        </PixelCard>
      </div>

      {/* 3D office preview — renders the office_room_complete.glb asset pack */}
      <PixelCard
        title="3D OFFICE PREVIEW"
        accent="#a78bfa"
        right={
          <span className="text-[10px] text-muted-foreground/70">drag to orbit</span>
        }
      >
        <PixelOffice3DScene onHotspotSelect={setActiveHotspot} />
      </PixelCard>

      {/* Tasks — deferred by CEO, no data source. Honest placeholder only. */}
      <PixelCard title="TASKS" accent="#6b7280">
        <div className="text-[11px] text-muted-foreground">
          ยังไม่มี execution log — ไม่มีแหล่งข้อมูลงานที่รันจริง (no execution log yet)
        </div>
      </PixelCard>

      {/* Hotspot drawer — opened by clicking the 3D office model (or its
          keyboard-accessible fallback buttons). Every branch reuses data
          already polled above; nothing here fetches anything new. */}
      <Drawer
        open={activeHotspot !== null}
        title={activeHotspot ? HOTSPOT_META[activeHotspot].title : ""}
        accent={activeHotspot ? HOTSPOT_META[activeHotspot].accent : ACCENT}
        onClose={() => setActiveHotspot(null)}
      >
        {activeHotspot === "agents" ? (
          <AIAgentsWidget
            data={agents.data ?? null}
            loading={agents.loading}
            error={agents.error ?? null}
          />
        ) : null}

        {activeHotspot === "systemHealth" ? (
          <div>
            <HealthRow
              label="Crypto prices"
              ok={cryptoLive}
              detail={crypto.error ? "error" : cryptoLive ? "live" : "mock"}
            />
            <HealthRow
              label="Affiliate feed"
              ok={affiliateLive}
              detail={affiliate.error ? "error" : affiliateLive ? "live" : "mock"}
            />
            <HealthRow
              label="Company holdings"
              ok={holdingsLive}
              detail={company.error ? "error" : holdingsLive ? "live" : "mock"}
            />
            <HealthRow
              label="AI agents"
              ok={!agents.error && agentErrors === 0}
              detail={
                agents.error ? "error" : agentErrors > 0 ? `${agentErrors} error` : "ok"
              }
            />
            <div className="mt-2 text-[9px] text-muted-foreground/60">
              * API latency, cache hit-rate, and rate-limit budget aren&apos;t wired to
              a real telemetry source yet — this panel only reflects the data-source
              flags above.
            </div>
          </div>
        ) : null}

        {activeHotspot === "trading" ? (
          <div className="space-y-3">
            <CryptoPricesWidget quotes={crypto.data?.quotes ?? []} source={crypto.data?.source} />
            <div className="text-[10px] text-muted-foreground">
              Grid Bot and V2 Trading (below, on this page) are UI-only mocks — MEXC has
              no public API for them yet.
            </div>
            <Link
              href="/portfolio"
              className="inline-block text-[10px] text-primary underline-offset-2 hover:underline"
            >
              View full portfolio →
            </Link>
          </div>
        ) : null}

        {activeHotspot === "strategy" ? (
          <div className="text-[11px] text-muted-foreground">
            ยังไม่มี execution log — ไม่มีแหล่งข้อมูลงานที่รันจริง (no execution log yet)
          </div>
        ) : null}

        {activeHotspot === "reports" ? (
          <div className="text-[11px] text-muted-foreground">
            Reports &amp; docs export isn&apos;t wired to a backend yet — coming soon.
          </div>
        ) : null}
      </Drawer>
    </PageShell>
  );
}
