import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ModelTypeButtons } from "@/components/ModelTypeButtons";
import { Navigation } from "@/components/Navigation";

// Self-hosted Geist (SIL OFL 1.1, see fonts/OFL.txt) so builds work offline.
const geistSans = localFont({
  src: "./fonts/Geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Local LLM Radar",
  description: "Attributed LLM benchmark comparisons and estimated local memory requirements.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <Navigation />
        <main className="flex-1">
          <ModelTypeButtons />
          {children}
        </main>
        <footer className="border-t border-zinc-800 py-4 px-6 text-center text-zinc-500 text-xs">
          <p>Local LLM Radar — a directional benchmark index. Verify the final pick against your own workload.</p>
          <p className="mt-1">
            Data by <a href="https://llm-stats.com" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-emerald-400">LLM Stats</a>
            {' · '}SWE-bench Verified results: <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-emerald-400">CC BY-NC 4.0</a>, non-commercial
            {' · '}KITTI depth: <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-emerald-400">CC BY-NC-SA 3.0</a>, non-commercial
            {' · '}Free, no ads, nothing sold
            {' · '}<a href="/sources" className="text-zinc-400 hover:text-emerald-400">All sources &amp; licences</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
