"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { address } from "@solana/kit";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  buildFundInstruction,
  buildUserReleaseInstruction,
  createSolanaRpcClient,
  deriveAssociatedTokenAddress,
  deriveEscrowConfigPda,
  deriveMerchantWalletPda,
  deriveOrderPda,
  deriveVaultPda,
  fetchAndDecodeAccount,
  hexToBytes,
  seedMerchantBySlug,
  ORDER_ESCROW_IDL,
} from "@merchantmesh/shared";
import { api } from "../lib/api";
import { usdc, skuLabel } from "../lib/format";
import { SOLANA_RPC_URL, USDC_MINT } from "../lib/solanaConfig";
import { sendKitInstructionBatch, sendKitInstructions } from "../lib/solanaWeb3Bridge";

export interface PgOrder {
  orderId: string;
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  items: { sku: string; qty: number }[];
  totalMicroUsdc: number;
  state: string;
  essential: boolean;
  note: string | null;
  escrow: {
    buyerAddress: string;
    amountMicroUsdc: number;
    quoteHash: string;
    pickupCodeHash: string;
    releaseDeadline: number;
    state: string;
    escrowOrderId: number | null;
    fundTxHash: string | null;
  } | null;
}

function ReceivedItemsRelease({ taskId, order, onReleased }: { taskId: string; order: PgOrder; onReleased: () => void }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const escrowOrderId = order.escrow?.escrowOrderId;
  const releasable = order.state === "ready" && escrowOrderId !== null && escrowOrderId !== undefined;

  const release = async () => {
    if (!publicKey || !USDC_MINT || escrowOrderId === null || escrowOrderId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const buyer = address(publicKey.toBase58());
      const usdcMint = address(USDC_MINT);
      const merchantNumericId = seedMerchantBySlug(order.merchantSlug).merchantId;
      const [orderPda] = await deriveOrderPda(escrowOrderId);
      const [vault] = await deriveVaultPda(escrowOrderId);
      const [merchantWallet] = await deriveMerchantWalletPda(merchantNumericId);
      const merchantWalletAccount = await fetchAndDecodeAccount<{ wallet: ReturnType<typeof address> }>(
        rpc,
        ORDER_ESCROW_IDL,
        "MerchantWallet",
        merchantWallet,
      );
      if (!merchantWalletAccount) throw new Error("Merchant payout wallet was not found on-chain.");
      const merchantTokenAccount = await deriveAssociatedTokenAddress(merchantWalletAccount.wallet, usdcMint);
      const instruction = buildUserReleaseInstruction(
        { buyer, order: orderPda, vault, merchantWallet, merchantTokenAccount },
        escrowOrderId,
      );
      const signature = await sendKitInstructions(connection, { publicKey, sendTransaction }, [instruction]);
      await api.releaseTx(taskId, order.orderId, escrowOrderId, signature);
      onReleased();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-border bg-card-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{order.merchantName}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm">{usdc(order.totalMicroUsdc)}</span>
          <span className="badge">{order.state}</span>
        </span>
      </div>
      {releasable ? (
        <>
          <p className="mt-2 text-sm text-success">Your basket is ready for pickup.</p>
          <p className="mt-1 text-xs text-muted">{order.items.map((item) => `${skuLabel(item.sku)} × ${item.qty}`).join(", ")}</p>
          <button className="btn btn-primary mt-3" disabled={busy} onClick={release}>
            {busy ? "Confirm in Phantom…" : `Confirm Pickup & Release ${usdc(order.totalMicroUsdc)}`}
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted">{order.items.map((item) => `${skuLabel(item.sku)} × ${item.qty}`).join(", ")}</p>
          {order.state === "paid_in_escrow" && <p className="mt-2 text-xs text-muted">Payment secured in escrow. Waiting for preparation.</p>}
          {order.state === "preparing" && <p className="mt-2 text-xs text-muted">Merchant is preparing your basket.</p>}
          {order.state === "completed" && <p className="mt-2 text-xs text-success">Pickup confirmed — payment released to the merchant.</p>}
        </>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </li>
  );
}

type Step = "idle" | "funding" | "verifying" | "done" | "error";

const rpc = createSolanaRpcClient({ rpcUrl: SOLANA_RPC_URL, cluster: "devnet" });

async function buildOrderFundInstruction(
  order: PgOrder,
  buyer: ReturnType<typeof address>,
  usdcMint: ReturnType<typeof address>,
  orderId: bigint,
) {
  if (!order.escrow) throw new Error(`Escrow details are missing for ${order.merchantSlug}.`);

  const merchantNumericId = seedMerchantBySlug(order.merchantSlug).merchantId;
  const [escrowConfig] = await deriveEscrowConfigPda();
  const [orderPda] = await deriveOrderPda(orderId);
  const [vault] = await deriveVaultPda(orderId);
  const [merchantWallet] = await deriveMerchantWalletPda(merchantNumericId);
  const buyerTokenAccount = await deriveAssociatedTokenAddress(buyer, usdcMint);

  return buildFundInstruction(
    { buyer, escrowConfig, merchantWallet, order: orderPda, usdcMint, vault, buyerTokenAccount },
    {
      orderId,
      amount: BigInt(order.escrow.amountMicroUsdc),
      quoteHash: hexToBytes(order.escrow.quoteHash),
      pickupCodeHash: hexToBytes(order.escrow.pickupCodeHash),
      releaseDeadline: BigInt(order.escrow.releaseDeadline),
    },
  );
}

async function getNextEscrowOrderId() {
  const [escrowConfig] = await deriveEscrowConfigPda();
  const config = await fetchAndDecodeAccount<{ next_order_id: bigint }>(rpc, ORDER_ESCROW_IDL, "EscrowConfig", escrowConfig);
  if (!config) throw new Error("escrow_config was not found on-chain.");
  return config.next_order_id;
}

async function assertSufficientWalletUsdc(
  connection: Connection,
  buyer: ReturnType<typeof address>,
  usdcMint: ReturnType<typeof address>,
  requiredMicroUsdc: number,
) {
  const tokenAccount = await deriveAssociatedTokenAddress(buyer, usdcMint);
  let available = 0n;
  try {
    const balance = await connection.getTokenAccountBalance(new PublicKey(tokenAccount), "confirmed");
    available = BigInt(balance.value.amount);
  } catch {
    // A missing associated token account is equivalent to a zero balance.
  }
  if (available < BigInt(requiredMicroUsdc)) {
    const displayAvailable = available <= BigInt(Number.MAX_SAFE_INTEGER) ? usdc(Number(available)) : `${available} micro-USDC`;
    throw new Error(`Insufficient wallet balance: ${displayAvailable} available, ${usdc(requiredMicroUsdc)} required.`);
  }
}

/**
 * Faz I §4 — fund() signed entirely by the connected wallet; the bridge
 * never signs on the user's behalf, it only verifies the resulting tx
 * afterwards (POST /tasks/:id/funding-tx → orchestrator.verifyFunding).
 * Persists across reloads since state comes from the task snapshot's
 * `pgOrders`, not local component state. No separate approve() step —
 * unlike ERC-20, an SPL transfer is authorized by the owner's own signature
 * on the instruction itself.
 */
export function FundingWizard({ taskId, order, onFunded }: { taskId: string; order: PgOrder; onFunded: () => void }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  if (!order.escrow) return null;
  const escrow = order.escrow;

  if (!USDC_MINT) {
    return <p className="text-xs text-danger">NEXT_PUBLIC_USDC_MINT is not configured.</p>;
  }

  const run = async () => {
    if (!publicKey) {
      setError("Wallet is not connected.");
      return;
    }
    if (!USDC_MINT) {
      setError("NEXT_PUBLIC_USDC_MINT is not configured.");
      return;
    }
    setError(null);
    try {
      setStep("funding");
      const usdcMint = address(USDC_MINT);
      const buyer = address(publicKey.toBase58());
      await assertSufficientWalletUsdc(connection, buyer, usdcMint, escrow.amountMicroUsdc);
      const orderId = await getNextEscrowOrderId();
      const ix = await buildOrderFundInstruction(order, buyer, usdcMint, orderId);
      const signature = await sendKitInstructions(connection, { publicKey, sendTransaction }, [ix]);

      setStep("verifying");
      await api.fundingTx(taskId, order.orderId, Number(orderId), signature);
      setStep("done");
      onFunded();
    } catch (err) {
      setStep("error");
      setError((err as Error).message);
    }
  };

  const busy = step === "funding" || step === "verifying";

  return (
    <li className="rounded-lg border border-brand bg-card-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{order.merchantName}</span>
        <span className="font-mono text-sm">{usdc(order.totalMicroUsdc)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{order.items.map((i) => `${skuLabel(i.sku)}×${i.qty}`).join(", ")}</p>
      <button className="btn btn-primary mt-2" onClick={run} disabled={busy || step === "done"}>
        {step === "idle" && "Fund Escrow"}
        {step === "funding" && "Funding escrow…"}
        {step === "verifying" && "Verifying…"}
        {step === "done" && "Funded ✔"}
        {step === "error" && "Try Again"}
      </button>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </li>
  );
}

function BatchFundingWizard({ taskId, orders, onFunded }: { taskId: string; orders: PgOrder[]; onFunded: () => void }) {
  const { publicKey, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const totalMicroUsdc = orders.reduce((sum, order) => sum + (order.escrow?.amountMicroUsdc ?? 0), 0);

  const run = async () => {
    if (!publicKey) {
      setError("Wallet is not connected.");
      return;
    }
    if (!USDC_MINT) {
      setError("NEXT_PUBLIC_USDC_MINT is not configured.");
      return;
    }

    setError(null);
    try {
      setStep("funding");
      const buyer = address(publicKey.toBase58());
      const usdcMint = address(USDC_MINT);
      await assertSufficientWalletUsdc(connection, buyer, usdcMint, totalMicroUsdc);
      const firstOrderId = await getNextEscrowOrderId();
      const assignments = orders.map((order, index) => ({ order, escrowOrderId: firstOrderId + BigInt(index) }));
      const instructions = await Promise.all(
        assignments.map(({ order, escrowOrderId }) => buildOrderFundInstruction(order, buyer, usdcMint, escrowOrderId)),
      );

      // One Phantom batch approval, one size-safe transaction per merchant.
      await sendKitInstructionBatch(
        connection,
        { publicKey, signAllTransactions },
        instructions.map((instruction) => [instruction]),
        async (signature, index) => {
          setStep("verifying");
          const { order, escrowOrderId } = assignments[index]!;
          await api.fundingTx(taskId, order.orderId, Number(escrowOrderId), signature);
        },
      );

      setStep("done");
      onFunded();
    } catch (err) {
      setStep("error");
      setError((err as Error).message);
    }
  };

  const busy = step === "funding" || step === "verifying";

  return (
    <div className="mb-3 rounded-lg border border-brand bg-card-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Final payment approval</h3>
          <p className="text-sm text-muted">
            {orders.length} merchant escrows · <strong className="text-ink">{usdc(totalMicroUsdc)}</strong> total
          </p>
          <p className="mt-1 text-xs text-muted">Phantom will ask once to batch-sign one escrow transaction per merchant.</p>
        </div>
        <button className="btn btn-primary" onClick={run} disabled={busy || step === "done"}>
          {step === "idle" && "Approve & Fund All Escrows"}
          {step === "funding" && "Confirm in Phantom…"}
          {step === "verifying" && "Verifying all escrows…"}
          {step === "done" && "All Escrows Funded ✔"}
          {step === "error" && "Try Batch Funding Again"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function PgOrdersBoard({ taskId, orders, onChanged }: { taskId: string; orders: PgOrder[]; onChanged: () => void }) {
  if (orders.length === 0) return null;
  const pending = orders.filter((o) => o.state === "merchant_pending");
  const funding = orders.filter((o) => o.state === "awaiting_funding");
  const rest = orders.filter((o) => o.state !== "merchant_pending" && o.state !== "awaiting_funding");

  return (
    <section className="card p-4">
      <h2 className="section-title mb-3">Merchant Approval and Funding (Live Mode)</h2>
      {pending.length > 0 && (
        <div className="mb-3">
          <div className="mb-2">
            <div>
              <p className="text-sm font-semibold">Waiting for merchant confirmation</p>
              <p className="text-xs text-muted">
                Stay on this page. Merchant responses appear here automatically; no console navigation is required.
              </p>
            </div>
          </div>
          <ul className="flex flex-col gap-1.5">
            {pending.map((o) => (
              <li key={o.orderId} className="rounded-lg border border-border bg-card-2 p-2 text-sm">
                {o.merchantName} — {usdc(o.totalMicroUsdc)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            After every merchant accepts, this section will show <strong className="text-ink">Approve &amp; Fund All Escrows</strong> and open Phantom once.
          </p>
        </div>
      )}
      {funding.length > 0 && (
        <>
          <BatchFundingWizard taskId={taskId} orders={funding} onFunded={onChanged} />
          <details>
            <summary className="cursor-pointer text-xs text-muted">Individual funding (retry only)</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {funding.map((o) => (
                <FundingWizard key={o.orderId} taskId={taskId} order={o} onFunded={onChanged} />
              ))}
            </ul>
          </details>
        </>
      )}
      {rest.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-2 font-semibold">Pickup Stops &amp; Escrow Release</h3>
          <ul className="flex flex-col gap-2">
          {rest.map((o) => (
            <ReceivedItemsRelease key={o.orderId} taskId={taskId} order={o} onReleased={onChanged} />
          ))}
          </ul>
        </div>
      )}
    </section>
  );
}
