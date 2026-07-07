import { SignIn } from "@clerk/nextjs";

// Clerk's <SignIn/> needs a runtime publishable key. Forcing dynamic rendering
// prevents the KEYLESS `next build` from trying to statically prerender it
// (which would throw without a key).
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className="grid h-full min-h-screen place-items-center bg-background p-4">
      <SignIn />
    </main>
  );
}
