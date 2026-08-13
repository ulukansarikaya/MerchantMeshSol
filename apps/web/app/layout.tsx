import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { WalletWidget } from "../components/WalletWidget";
import { AdminNavLink } from "../components/AdminNavLink";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "MerchantMesh",
  description: "Local AI shopping powered by merchant agents on Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen">
        <Providers>
          <header className="border-b border-border bg-surface">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-6">
                <Link href="/" className="text-lg font-bold tracking-tight">
                  <span className="text-brand">Merchant</span>Mesh
                </Link>
                <nav className="flex items-center gap-4 text-sm text-muted">
                  <Link href="/" className="hover:text-ink">Shopping</Link>
                  <Link href="/merchant-dashboard" className="hover:text-ink">Merchant Dashboard</Link>
                  <AdminNavLink />
                </nav>
              </div>
              <WalletWidget />
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-5xl px-4 pb-8 pt-4 text-xs text-muted">
            Mock mode uses a simulated session wallet and chain. In live mode, sign in with your wallet; research micropayments
            use the session wallet, while final escrow funding always uses your connected wallet.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
