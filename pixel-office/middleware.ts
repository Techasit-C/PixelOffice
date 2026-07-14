// Clerk middleware. Populates the auth context so `auth()` works in Route Handlers.
// It does NOT hard-block requests here — each portfolio handler enforces 401/404
// itself (so API callers get JSON, not an HTML redirect).
//
// Guarded for missing keys: without Clerk env vars (local/dev), we skip Clerk
// entirely and pass through, so the app still runs and builds. Portfolio routes
// then return 401 (auth() throws -> Unauthorized), which is the correct behavior.
import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const hasClerkKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY;

// PAGE routes that require a signed-in user. Signed-out visitors to these get
// redirected to the sign-in page (auth.protect() on a document request).
//
// Deliberately EXCLUDES /api/** : API handlers self-enforce via requireUser()
// and must answer JSON 401, never an HTML sign-in redirect. /sign-in and
// /sign-up are also excluded so the auth surface itself stays reachable.
const isProtectedPage = createRouteMatcher([
  "/portfolio(.*)",
  "/executive(.*)",
  "/operations(.*)",
  "/mission-control(.*)",
  "/trading-bot(.*)",
]);

const passthrough = () => NextResponse.next();

// Callback form: populate auth context for every matched route (so API handlers'
// auth() works), but only hard-redirect the protected PAGE routes.
const withClerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedPage(req)) {
    await auth.protect();
  }
});

export default hasClerkKeys ? withClerk : passthrough;

export const config = {
  matcher: [
    // Skip Next internals and static files, run on everything else + all API routes.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|png|gif|svg|ico|webp|woff2?|ttf)).*)",
    "/(api|trpc)(.*)",
  ],
};
