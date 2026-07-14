// /api/health — trivial liveness probe for external readiness checks (e.g. the
// Electron shell polling before it shows the embedded Pixel Office view). No auth: the
// response carries no user/tenant data, just a static ok, so gating it would only slow
// down startup polling for no security benefit.
export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
