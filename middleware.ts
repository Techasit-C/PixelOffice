// Clerk middleware. Populates the auth context so `auth()` works in Route Handlers.
// It does NOT hard-block requests here — each portfolio handler enforces 401/404
// itself (so API callers get JSON, not an HTML redirect).
//
// Guarded for missing keys: without Clerk env vars (local/dev), we skip Clerk
// entirely and pass through, so the app still runs and builds. Portfolio routes
// then return 401 (auth() throws -> Unauthorized), which is the correct behavior.
import { NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

const hasClerkKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY;

const passthrough = () => NextResponse.next();

export default hasClerkKeys ? clerkMiddleware() : passthrough;

export const config = {
  matcher: [
    // Skip Next internals and static files, run on everything else + all API routes.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|png|gif|svg|ico|webp|woff2?|ttf)).*)",
    "/(api|trpc)(.*)",
  ],
};
