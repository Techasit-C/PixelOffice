import type { Metadata } from "next";
import { Press_Start_2P, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

// KEYLESS-BOOT INVARIANT (mirrors middleware.ts): only mount <ClerkProvider>
// when Clerk keys are present. ClerkProvider throws without a publishable key,
// so in keyless dev/build we render the app untouched and it still boots.
const hasClerkKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY;

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const pixelFont = Press_Start_2P({
  variable: "--font-pixel",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pixel Dream Games — Office",
  description: "Pixel-art AI agent office dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const tree = (
    <html
      lang="th"
      className={`${inter.variable} ${pixelFont.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-background text-foreground">
        {children}
      </body>
    </html>
  );

  // Keyless: render the app as-is (no Clerk context) so dev/build still boot.
  if (!hasClerkKeys) return tree;

  // Keyed: provide Clerk context, themed to the dark pixel palette.
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorBackground: "#0b0d14",
          colorPrimary: "#3b82f6",
          colorForeground: "#f4f4f5",
          colorInput: "#11131b",
          colorInputForeground: "#f4f4f5",
        },
      }}
    >
      {tree}
    </ClerkProvider>
  );
}
