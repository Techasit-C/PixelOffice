"use client";

// Auth control for the app header. Signed-out users see a link to the embedded
// /sign-in surface; signed-in users see Clerk's <UserButton> (which owns
// sign-out). This version of @clerk/nextjs has NO <SignedIn>/<SignedOut>; the
// replacement is the unified <Show when="signed-in" | "signed-out">.
//
// KEYLESS GUARD: Clerk's client components need <ClerkProvider> context, which
// is only mounted when keys exist (see app/layout.tsx). We gate on the inlined
// NEXT_PUBLIC_ key so keyless dev renders nothing here instead of crashing.
import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function HeaderAuth() {
  if (!clerkEnabled) return null;

  return (
    <>
      <Show when="signed-out">
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-white/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          เข้าสู่ระบบ
        </Link>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}
