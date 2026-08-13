"use client";

import { useCallback, useEffect, useState } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { api } from "../lib/api";
import { usdc } from "../lib/format";
import { platformApi } from "../lib/platformApi";
import { IS_MOCK, useSession } from "../lib/useSession";

function MockWalletWidget() {
  const [wallet, setWallet] = useState<{ address: string; balanceMicroUsdc: number; mode: string } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .wallet()
        .then((w) => alive && (setWallet(w), setError(false)))
        .catch(() => alive && setError(true));
    load();
    const timer = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (error) {
    return <div className="badge badge-off">bridge offline (:3001)</div>;
  }
  if (!wallet) return <div className="badge">wallet…</div>;

  return (
    <div className="flex items-center gap-2">
      <span className="badge badge-on" title="Simulated session wallet in mock mode">
        ● Simulated Session Wallet
      </span>
      <span className="badge font-mono" title={wallet.address}>
        {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
      </span>
      <span className="badge text-ink">{usdc(wallet.balanceMicroUsdc)}</span>
    </div>
  );
}

/**
 * Solana has no chain-switching step (unlike EVM's `wallet_switchEthereumChain`)
 * and no standardized Sign-In-With-Solana parser in this dependency set, so
 * sign-in is a small fixed plain-text message (built here, re-parsed by
 * platform-api's `parseSignInMessage`) signed via the wallet's `signMessage`.
 */
function buildSignInMessage(address: string, nonce: string): string {
  return [
    `${window.location.host} wants you to sign in with your Solana account:`,
    address,
    "",
    "Sign in to MerchantMesh.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

function RealWalletWidget() {
  const [mounted, setMounted] = useState(false);
  const { publicKey, connected, signMessage, disconnect } = useWallet();
  const { account, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) return;
    setBusy(true);
    setError(null);
    try {
      const address = publicKey.toBase58();
      const { nonce } = await platformApi.nonce();
      const message = buildSignInMessage(address, nonce);
      const signatureBytes = await signMessage(new TextEncoder().encode(message));
      const signature = bs58.encode(signatureBytes);
      await platformApi.verify(message, signature, address);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [publicKey, signMessage, refresh]);

  const logout = useCallback(async () => {
    await platformApi.logout();
    await disconnect();
    refresh();
  }, [disconnect, refresh]);

  if (!mounted) {
    return (
      <button
        type="button"
        className="wallet-adapter-button wallet-adapter-button-trigger"
        disabled
        aria-label="Loading wallet options"
      >
        Select Wallet
      </button>
    );
  }

  if (!connected || !publicKey) {
    return <WalletMultiButton />;
  }

  const address = publicKey.toBase58();

  if (!account) {
    return (
      <div className="flex items-center gap-2">
        <span className="badge font-mono" title={address}>
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button className="btn btn-primary" onClick={signIn} disabled={busy}>
          {busy ? "Signing…" : "Sign In"}
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="badge badge-on" title={account.agentId}>
        ● {account.activeMode === "merchant" ? "Merchant" : "Customer"} Agent
      </span>
      <span className="badge font-mono" title={account.walletAddress}>
        {account.walletAddress.slice(0, 6)}…{account.walletAddress.slice(-4)}
      </span>
      <button className="btn" onClick={logout}>
        Sign Out
      </button>
    </div>
  );
}

export function WalletWidget() {
  return IS_MOCK ? <MockWalletWidget /> : <RealWalletWidget />;
}
