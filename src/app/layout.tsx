import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = { title: "PROXY — Supplier Intelligence & RFQ Security", description: "Live supplier discovery, evidence provenance and secure RFQ preparation." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar />
            <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-6"><div className="mx-auto max-w-[1400px]">{children}</div></main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
