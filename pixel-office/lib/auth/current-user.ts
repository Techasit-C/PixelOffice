// Auth helper — resolves the current INTERNAL User.id from Clerk's clerkUserId.
//
// Every portfolio-scoped query keys off the internal User.id, so all request
// handlers start here. Degrades safely when Clerk is not configured (no keys):
// auth() throws -> we surface Unauthorized (401), never a 500, and the build never
// imports Clerk keys at module load (auth() reads env lazily at call time).
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Unauthorized } from "@/lib/api/errors";

export interface AuthedUser {
  userId: string; // internal User.id (tenant key for all portfolio queries)
  clerkUserId: string;
}

/**
 * Resolve the signed-in user, provisioning a local User row on first sight
 * (Clerk owns identity; we mirror the minimum: clerkUserId + email + name).
 * Throws Unauthorized if there is no valid session or Clerk is unconfigured.
 */
export async function requireUser(): Promise<AuthedUser> {
  let clerkUserId: string | null = null;
  try {
    const session = await auth();
    clerkUserId = session.userId;
  } catch {
    // Clerk not configured / middleware not applied — treat as unauthenticated.
    throw new Unauthorized();
  }
  if (!clerkUserId) throw new Unauthorized();

  const existing = await prisma.user.findUnique({ where: { clerkUserId } });
  if (existing) return { userId: existing.id, clerkUserId };

  // First request from this Clerk user: fetch profile + provision a local row.
  const profile = await currentUser();
  const displayName =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || null;

  // SECURITY (CR-003 F-05): `email` is a UNIQUE column but Clerk does NOT guarantee
  // email uniqueness across accounts (nor is a real email always exposed). Writing a
  // user's real email here risks a P2002 unique-violation that locks a legitimate
  // user out of provisioning (a DoS / account-takeover-adjacent hazard). We therefore
  // ALWAYS store a deterministic, guaranteed-unique placeholder derived from the
  // (already-unique) clerkUserId. Clerk remains the source of truth for the real
  // email; we intentionally do not mirror it into this unique column. (No schema
  // change: there is no non-unique email field to hold the real address.)
  const email = `${clerkUserId}@clerk.local`;

  // upsert guards the race where two concurrent requests both see "no user".
  const user = await prisma.user.upsert({
    where: { clerkUserId },
    create: { clerkUserId, email, displayName },
    update: {},
  });
  return { userId: user.id, clerkUserId };
}
