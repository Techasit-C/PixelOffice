import PixelOfficeNoSSR from "@/components/pixel-office/NoSSR";

// This page is inherently client-only: drag positions, localStorage-backed
// window layout, Math.random-driven character movement, and direct DOM
// script injection (TradingView widget) all diverge between server and
// client. Rendering it on the server produces no useful markup and only
// causes hydration mismatches, so skip SSR for it entirely (see NoSSR.tsx —
// `ssr: false` has to live in a Client Component, not here).
export default function Page() {
  return <PixelOfficeNoSSR />;
}
