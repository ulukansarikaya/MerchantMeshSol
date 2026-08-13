"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getTransferInstruction } from "@solana-program/token";
import { AccountRole, address, type Instruction } from "@solana/kit";
import { deriveAssociatedTokenAddress } from "@merchantmesh/shared";
import { platformApi } from "../lib/platformApi";
import { usdc } from "../lib/format";
import { USDC_MINT } from "../lib/solanaConfig";
import { sendKitInstructions } from "../lib/solanaWeb3Bridge";

/** Top up to this balance instead of adding another full amount on every click. */
const TARGET_BALANCE_MICRO = 1_000_000; // 1 test USDC

/**
 * Faz J §1/§4 — "research wallet" load card. The user's connected wallet
 * sends USDC directly to the session wallet's associated token account (a
 * plain SPL transfer — Solana doesn't have ERC-20's separate approve() step,
 * the wallet just signs the transfer). Withdrawing back out only ever goes
 * to the account's own registered wallet (enforced server-side too, not
 * just in this UI).
 */
export function SessionWalletCard() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"load" | "withdraw" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: wallet, isLoading } = useQuery({
    queryKey: ["session-wallet"],
    queryFn: () => platformApi.sessionWallet(),
    refetchInterval: 15_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["session-wallet"] });

  const loadWallet = async () => {
    if (!wallet || !publicKey || !USDC_MINT) return;
    const targetBalanceMicro = Math.min(TARGET_BALANCE_MICRO, wallet.limits.maxBalanceMicroUsdc);
    const topUpMicro = Math.max(0, targetBalanceMicro - wallet.balanceMicroUsdc);
    if (topUpMicro === 0) return;
    setBusy("load");
    setError(null);
    try {
      const mint = address(USDC_MINT);
      const owner = address(publicKey.toBase58());
      const recipient = address(wallet.address);
      const source = await deriveAssociatedTokenAddress(owner, mint);
      const destination = await deriveAssociatedTokenAddress(recipient, mint);
      // Wallet Adapter is not a @solana/kit TransactionSigner, so build this
      // instruction explicitly while preserving the wallet's signer role.
      const createDestination: Instruction = {
        programAddress: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
        accounts: [
          { address: owner, role: AccountRole.WRITABLE_SIGNER },
          { address: destination, role: AccountRole.WRITABLE },
          { address: recipient, role: AccountRole.READONLY },
          { address: mint, role: AccountRole.READONLY },
          { address: address("11111111111111111111111111111111"), role: AccountRole.READONLY },
          { address: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), role: AccountRole.READONLY },
        ],
        data: new Uint8Array([1]), // CreateIdempotent
      };
      const transfer = getTransferInstruction({
        source,
        destination,
        authority: owner,
        amount: BigInt(topUpMicro),
      });
      await sendKitInstructions(connection, { publicKey, sendTransaction }, [createDestination, transfer]);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async () => {
    if (!publicKey) return;
    setBusy("withdraw");
    setError(null);
    try {
      await platformApi.withdrawSessionWallet(publicKey.toBase58());
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !wallet) {
    return <div className="card p-3 text-sm text-muted">Loading research wallet…</div>;
  }

  const empty = wallet.balanceMicroUsdc === 0;
  const targetBalanceMicro = Math.min(TARGET_BALANCE_MICRO, wallet.limits.maxBalanceMicroUsdc);
  const topUpMicro = Math.max(0, targetBalanceMicro - wallet.balanceMicroUsdc);

  return (
    <div className={`card flex flex-col gap-2 p-3 ${empty ? "border-warning" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="section-title">Research Wallet</span>
        <span className="font-mono text-xs text-muted" title={wallet.address}>
          {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className={empty ? "text-warning" : "text-ink"}>{usdc(wallet.balanceMicroUsdc)}</span>
        <span className="text-xs text-muted">
          today: {usdc(wallet.dailySpentMicroUsdc)} / {usdc(wallet.limits.perDayMicroUsdc)}
        </span>
      </div>
      {wallet.frozen && <p className="text-xs text-danger">Wallet frozen — contact support.</p>}
      {empty && !wallet.frozen && (
        <p className="text-xs text-warning">Empty — add USDC before starting a task (Solana Devnet faucet).</p>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary text-xs" onClick={loadWallet} disabled={busy !== null || !publicKey || !USDC_MINT || topUpMicro === 0}>
          {busy === "load" ? "Loading…" : topUpMicro > 0 ? `Top up ${usdc(topUpMicro)}` : "1.00 USDC ready"}
        </button>
        <button className="btn text-xs" onClick={withdraw} disabled={busy !== null || wallet.balanceMicroUsdc === 0}>
          {busy === "withdraw" ? "Withdrawing…" : "Withdraw All"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {!USDC_MINT && <p className="text-xs text-muted">NEXT_PUBLIC_USDC_MINT is not configured — deposits are disabled.</p>}
    </div>
  );
}
