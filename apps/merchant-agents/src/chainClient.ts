import { createKeyPairSignerFromPrivateKeyBytes, type Address, type KeyPairSigner } from "@solana/kit";
import {
  buildConfirmPickupInstruction,
  buildMarkPreparingInstruction,
  buildMarkReadyInstruction,
  createSolanaRpcClient,
  deriveAssociatedTokenAddress,
  deriveMerchantWalletPda,
  deriveOrderPda,
  deriveVaultPda,
  fetchAndDecodeAccount,
  hexToBytes,
  keccak256HexUtf8,
  sendAndConfirmInstructions,
  ORDER_ESCROW_IDL,
  type SolanaEnvConfig,
} from "@merchantmesh/shared";

/**
 * Merchant-side view of the escrow chain.
 *
 * Mock mode: the simulated chain lives in the local-agent-bridge (:3001) —
 * merchants call its /chain/* endpoints exactly like they would submit txs.
 * Real mode: signs order_escrow instructions with one merchant signer key at
 * a time (see SolanaMerchantChainClient below).
 */
export interface MerchantChainClient {
  markPreparing(escrowOrderId: number, signerKey: string): Promise<{ txRef: string }>;
  markReady(escrowOrderId: number, signerKey: string): Promise<{ txRef: string }>;
  confirmPickup(escrowOrderId: number, code: string, signerKey: string): Promise<{ txRef: string; released: boolean }>;
}

export class MockChainClient implements MerchantChainClient {
  constructor(private bridgeUrl: string) {}

  private async call(path: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.bridgeUrl}/chain/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as any;
    if (!res.ok) throw new Error(`chain ${path} failed: ${json.error ?? res.status}`);
    return json;
  }

  // signerKey is unused in mock mode — the bridge's simulated chain has no
  // per-merchant signing concept, it just trusts the caller.
  markPreparing(escrowOrderId: number) {
    return this.call("mark-preparing", { escrowOrderId });
  }
  markReady(escrowOrderId: number) {
    return this.call("mark-ready", { escrowOrderId });
  }
  confirmPickup(escrowOrderId: number, code: string) {
    return this.call("confirm-pickup", { escrowOrderId, code });
  }
}

interface DecodedOrder {
  merchant_id: bigint;
  buyer: Address;
}

/**
 * Real-mode client. Each call is signed with the *specific merchant's* own
 * key (passed in per-call, since one merchant-agents process serves all 5
 * seed merchants — see plans/faz-b.md §4) — order_escrow checks the signer
 * against `MerchantWallet.wallet`, so it must be exactly that merchant's key.
 */
export class SolanaMerchantChainClient implements MerchantChainClient {
  private rpc: ReturnType<typeof createSolanaRpcClient>;

  constructor(
    cfg: SolanaEnvConfig,
    private usdcMint: Address,
    private minConfirmations: number,
  ) {
    this.rpc = createSolanaRpcClient(cfg);
    void this.minConfirmations; // kept for parity with the old constructor shape — see chain.ts's SolanaChainProvider
  }

  private async signerFor(signerKeyHex: string): Promise<KeyPairSigner> {
    return createKeyPairSignerFromPrivateKeyBytes(hexToBytes(signerKeyHex));
  }

  private async loadOrder(escrowOrderId: number) {
    const [order] = await deriveOrderPda(escrowOrderId);
    const decoded = await fetchAndDecodeAccount<DecodedOrder>(this.rpc, ORDER_ESCROW_IDL, "Order", order);
    if (!decoded) throw new Error(`escrow order not found: ${escrowOrderId}`);
    const [merchantWallet] = await deriveMerchantWalletPda(decoded.merchant_id);
    return { order, merchantWallet, buyer: decoded.buyer };
  }

  async markPreparing(escrowOrderId: number, signerKey: string): Promise<{ txRef: string }> {
    const signer = await this.signerFor(signerKey);
    const { order, merchantWallet } = await this.loadOrder(escrowOrderId);
    const ix = buildMarkPreparingInstruction({ merchant: signer.address, merchantWallet, order }, escrowOrderId);
    const signature = await sendAndConfirmInstructions(this.rpc, signer, [ix]);
    return { txRef: signature };
  }

  async markReady(escrowOrderId: number, signerKey: string): Promise<{ txRef: string }> {
    const signer = await this.signerFor(signerKey);
    const { order, merchantWallet } = await this.loadOrder(escrowOrderId);
    const ix = buildMarkReadyInstruction({ merchant: signer.address, merchantWallet, order }, escrowOrderId);
    const signature = await sendAndConfirmInstructions(this.rpc, signer, [ix]);
    return { txRef: signature };
  }

  async confirmPickup(escrowOrderId: number, code: string, signerKey: string): Promise<{ txRef: string; released: boolean }> {
    const signer = await this.signerFor(signerKey);
    const { order, merchantWallet, buyer } = await this.loadOrder(escrowOrderId);
    const [vault] = await deriveVaultPda(escrowOrderId);
    const merchantTokenAccount = await deriveAssociatedTokenAddress(signer.address, this.usdcMint);
    const ix = buildConfirmPickupInstruction(
      { merchant: signer.address, merchantWallet, order, vault, merchantTokenAccount, buyer },
      escrowOrderId,
      code,
    );
    // confirm_pickup either releases the vault or reverts the whole
    // transaction (WrongPickupCode/WrongState) — if it didn't throw, it released.
    const signature = await sendAndConfirmInstructions(this.rpc, signer, [ix]);
    return { txRef: signature, released: true };
  }

  /** Local pre-check mirroring the program's keccak256(code) == pickup_code_hash — no RPC call. */
  static codeMatchesHash(code: string, pickupCodeHashHex: string): boolean {
    return keccak256HexUtf8(code) === pickupCodeHashHex;
  }
}
