"use client";

import { useEffect, useMemo, useState } from "react";
import { OfficeScene } from "@/components/pixel-office/OfficeScene";
import { ControlBar } from "@/components/pixel-office/ControlBar";
import { WidgetWindow } from "@/components/widgets/WidgetWindow";
import { AffiliateWidget } from "@/components/widgets/AffiliateWidget";
import { CompanyStatusWidget } from "@/components/widgets/CompanyStatusWidget";
import { GridBotWidget } from "@/components/widgets/GridBotWidget";
import { AIAgentsWidget } from "@/components/widgets/AIAgentsWidget";
import { TradingWidget } from "@/components/widgets/TradingWidget";
import { CryptoPricesWidget } from "@/components/widgets/CryptoPricesWidget";
import { TeamChatWidget } from "@/components/widgets/TeamChatWidget";
import { LofiWidget } from "@/components/widgets/LofiWidget";
import { TradingViewChartWidget } from "@/components/widgets/TradingViewChartWidget";
import { TVSignalsWidget } from "@/components/widgets/TVSignalsWidget";
import { PortfolioWidget } from "@/components/widgets/PortfolioWidget";
import {
  WidgetGatedNotice,
  type WidgetGateReason,
} from "@/components/widgets/WidgetGatedNotice";
import { useWindowManager, type LayoutMap } from "@/lib/use-window-manager";
import {
  makeAffiliateData,
  makeCompanyStatusData,
  makeCryptoPrices,
  makeGridBotData,
  makeTradingData,
  jitter,
  nowClock,
  type ChatEntry,
} from "@/lib/mock-data";
import type { TVAlert } from "@/lib/tradingview-alerts";
import type { AgentsResponse } from "@/types/agent";

// The office scene now stacks a lobby strip + 5 department floors down the
// center band (x 340-1340, y 20-1854) — see OfficeScene.tsx. The
// bottom-center widgets (trading/tvChart/tvSignals/teamChat) are pushed
// below that content so they never sit on top of the new trading/developer
// desks; the side-column widgets (x 20 and x 1360) are already clear of the
// center band.
const DEFAULT_LAYOUT: LayoutMap = {
  affiliate: { x: 20, y: 20, minimized: false, closed: false },
  companyStatus: { x: 1360, y: 20, minimized: false, closed: false },
  portfolio: { x: 1360, y: 640, minimized: false, closed: false },
  gridBot: { x: 20, y: 330, minimized: false, closed: false },
  cryptoPrices: { x: 1360, y: 330, minimized: false, closed: false },
  aiAgents: { x: 20, y: 640, minimized: false, closed: false },
  trading: { x: 400, y: 1900, minimized: false, closed: false },
  tvChart: { x: 750, y: 1880, minimized: false, closed: false },
  tvSignals: { x: 1230, y: 1880, minimized: false, closed: false },
  teamChat: { x: 900, y: 2180, minimized: false, closed: false },
  lofi: { x: 1360, y: 950, minimized: false, closed: false },
};

const WIDGET_META: Record<
  string,
  { title: string; width: number; accent: string }
> = {
  affiliate: { title: "รายได้ AFFILIATE วันนี้", width: 300, accent: "#f2c14e" },
  companyStatus: { title: "COMPANY STATUS", width: 300, accent: "#3b82f6" },
  portfolio: { title: "PORTFOLIO", width: 300, accent: "#22c55e" },
  gridBot: { title: "GRID BOT", width: 300, accent: "#22d3ee" },
  cryptoPrices: { title: "CRYPTO PRICES", width: 300, accent: "#22d3ee" },
  aiAgents: { title: "AI AGENTS", width: 300, accent: "#a78bfa" },
  trading: { title: "V2 TRADING", width: 320, accent: "#3b82f6" },
  tvChart: { title: "TV CHART", width: 460, accent: "#2962ff" },
  tvSignals: { title: "TV SIGNALS", width: 280, accent: "#2962ff" },
  teamChat: { title: "TEAM CHAT", width: 340, accent: "#ec4899" },
  lofi: { title: "LOFI BEATS TO CODE", width: 300, accent: "#8b5cf6" },
};

// Map an auth-gated read HTTP status to a degraded-placeholder reason for the
// PUBLIC root page. 401 = logged-out visitor (this route is intentionally public,
// see app/page.tsx); 429 = per-user rate limit. Any other status is a normal
// transient error and is handled by the existing catch (keep last-good state).
function gateReasonFor(status: number): WidgetGateReason | null {
  if (status === 401) return "auth";
  if (status === 429) return "rate";
  return null;
}

export default function PixelOfficePageClient() {
  const wm = useWindowManager(DEFAULT_LAYOUT);

  const [affiliate, setAffiliate] = useState(makeAffiliateData());
  const [companyStatus, setCompanyStatus] = useState(makeCompanyStatusData());
  const [gridBot, setGridBot] = useState(makeGridBotData());
  const [trading, setTrading] = useState(makeTradingData());
  const [agents, setAgents] = useState<AgentsResponse | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState(makeCryptoPrices());
  const [quotesSource, setQuotesSource] = useState<"coingecko" | "mock">();
  const [tvAlerts, setTvAlerts] = useState<TVAlert[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);

  // Degradation gates for the auth-gated reads (M6.1). Null = show data as usual;
  // "auth"/"rate" = render a calm placeholder instead. Gated on the RESPONSE STATUS
  // (not the page), so signed-in dashboards — which get 200s — are unaffected.
  const [companyGate, setCompanyGate] = useState<WidgetGateReason | null>(null);
  const [quotesGate, setQuotesGate] = useState<WidgetGateReason | null>(null);
  const [affiliateGate, setAffiliateGate] = useState<WidgetGateReason | null>(
    null,
  );
  const [tvGate, setTvGate] = useState<WidgetGateReason | null>(null);

  // Grid Bot / V2 Trading: MEXC has no public API for its native grid bots
  // (UI-only feature), so these stay mock — just tick gently to feel alive.
  useEffect(() => {
    const id = setInterval(() => {
      const t = nowClock();
      setGridBot((d) => ({
        ...d,
        gridProfit: jitter(d.gridProfit, 0.02),
        updatedAt: t,
      }));
      setTrading((d) => ({ ...d, updatedAt: t }));
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // AI agents: read from agent files on the host. These change rarely, so poll
  // on a gentle 60s interval (matches the crypto/affiliate/company cadence on
  // this page). Honest states — no fake fallback on empty/error; the loading
  // gate only trips on first settle, so background refreshes don't flicker.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/agents");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: AgentsResponse = await res.json();
        if (cancelled) return;
        setAgents(json);
        setAgentsError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("agents fetch failed", err);
        setAgentsError(err instanceof Error ? err.message : "unknown error");
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Real data: MEXC account holdings (BTC/USDT), mock fallback for PnL fields
  // that a plain balance snapshot cannot provide. Auth-gated (M6.1): a logged-out
  // visitor on this public page gets 401 -> degrade to placeholder, never crash.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/company-status");
        const gate = gateReasonFor(res.status);
        if (gate) {
          if (cancelled) return;
          setCompanyGate(gate);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setCompanyStatus(json);
        setCompanyGate(null);
      } catch (err) {
        console.error("company-status poll failed", err);
      }
    }
    poll();
    const id = setInterval(poll, 45_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Real data: CoinGecko live prices. Auth-gated (M6.1) — degrade on 401/429.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/crypto-prices");
        const gate = gateReasonFor(res.status);
        if (gate) {
          if (cancelled) return;
          setQuotesGate(gate);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setQuotes(json.quotes);
        setQuotesSource(json.source);
        setQuotesGate(null);
      } catch (err) {
        console.error("crypto-prices poll failed", err);
      }
    }
    poll();
    const id = setInterval(poll, 45_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Real data (scaffolded): Bybit/Bitget affiliate earnings, mock fallback until keys are set.
  // Auth-gated (M6.1) — degrade on 401/429.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/affiliate");
        const gate = gateReasonFor(res.status);
        if (gate) {
          if (cancelled) return;
          setAffiliateGate(gate);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setAffiliate(json);
        setAffiliateGate(null);
      } catch (err) {
        console.error("affiliate poll failed", err);
      }
    }
    poll();
    const id = setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // TradingView alert webhooks (POST /api/tradingview-webhook), polled for display.
  // GET is auth-gated (M6.1) — degrade on 401/429.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/tradingview-webhook");
        const gate = gateReasonFor(res.status);
        if (gate) {
          if (cancelled) return;
          setTvGate(gate);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setTvAlerts(json.alerts);
        setTvGate(null);
      } catch (err) {
        console.error("tradingview-webhook poll failed", err);
      }
    }
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function handleSend(text: string) {
    setChat((prev) => [
      ...prev,
      { id: crypto.randomUUID(), author: "you", text, timestamp: nowClock() },
    ]);
  }

  const closedWidgets = useMemo(
    () =>
      Object.entries(wm.layout)
        .filter(([, l]) => l.closed)
        .map(([id]) => ({ id, title: WIDGET_META[id]?.title ?? id })),
    [wm.layout],
  );

  function renderContent(id: string) {
    switch (id) {
      case "affiliate":
        return affiliateGate ? (
          <WidgetGatedNotice reason={affiliateGate} />
        ) : (
          <AffiliateWidget data={affiliate} />
        );
      case "companyStatus":
        return companyGate ? (
          <WidgetGatedNotice reason={companyGate} />
        ) : (
          <CompanyStatusWidget data={companyStatus} />
        );
      case "portfolio":
        return <PortfolioWidget />;
      case "gridBot":
        return <GridBotWidget data={gridBot} mock />;
      case "cryptoPrices":
        return quotesGate ? (
          <WidgetGatedNotice reason={quotesGate} />
        ) : (
          <CryptoPricesWidget quotes={quotes} source={quotesSource} />
        );
      case "aiAgents":
        return (
          <AIAgentsWidget
            data={agents}
            loading={agentsLoading}
            error={agentsError}
          />
        );
      case "trading":
        return <TradingWidget data={trading} mock />;
      case "tvChart":
        return <TradingViewChartWidget />;
      case "tvSignals":
        return tvGate ? (
          <WidgetGatedNotice reason={tvGate} />
        ) : (
          <TVSignalsWidget alerts={tvAlerts} />
        );
      case "teamChat":
        return <TeamChatWidget entries={chat} onSend={handleSend} />;
      case "lofi":
        return <LofiWidget />;
      default:
        return null;
    }
  }

  return (
    <div className="relative h-full w-full overflow-auto bg-black">
      <div className="relative" style={{ width: 1700, height: 2600 }}>
        <OfficeScene agents={agents} />

        {Object.keys(DEFAULT_LAYOUT).map((id) => {
          const meta = WIDGET_META[id];
          const layout = wm.layout[id];
          if (!meta || !layout) return null;
          return (
            <WidgetWindow
              key={id}
              id={id}
              title={meta.title}
              width={meta.width}
              accent={meta.accent}
              layout={layout}
              zIndex={wm.zIndexOf(id)}
              onMove={wm.updatePosition}
              onMinimize={wm.toggleMinimize}
              onClose={wm.closeWindow}
              onFocus={wm.bringToFront}
            >
              {renderContent(id)}
            </WidgetWindow>
          );
        })}
      </div>

      <ControlBar
        onResetLayout={wm.resetLayout}
        closedWidgets={closedWidgets}
        onReopen={wm.openWindow}
      />
    </div>
  );
}
