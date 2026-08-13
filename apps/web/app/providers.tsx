"use client";

import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { useStandardWalletAdapters } from "@solana/wallet-standard-wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import "@solana/wallet-adapter-react-ui/styles.css";
import { SOLANA_RPC_URL } from "../lib/solanaConfig";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  // Every wallet that implements the Wallet Standard (Phantom, Solflare,
  // Backpack, ...) is auto-detected — but that detection is event-based
  // (the extension dispatches wallet-standard:register-wallet on load) and
  // can race with React mounting in dev mode, causing an installed wallet to
  // go undetected. Phantom/Solflare's own adapters are passed explicitly as
  // a fallback so they're always connectable even if standard-detection
  // misses the registration event; useStandardWalletAdapters dedupes if the
  // same wallet is also detected via the standard.
  const baseWallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  const wallets = useStandardWalletAdapters(baseWallets);
  const endpoint = useMemo(() => SOLANA_RPC_URL, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
