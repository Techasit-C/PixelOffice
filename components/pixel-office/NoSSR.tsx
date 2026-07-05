"use client";

import dynamic from "next/dynamic";

const PixelOfficePageClient = dynamic(() => import("./PixelOfficePageClient"), {
  ssr: false,
});

export default function PixelOfficeNoSSR() {
  return <PixelOfficePageClient />;
}
