import { randomBytes } from "node:crypto";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import {
  SEED_MERCHANTS,
  devAddress,
  BUYER_KEY_INDEX,
  bytesToHex,
  hexToBytes,
  keccak256HexUtf8,
  createSolanaRpcClient,
  readSolanaEnvConfig,
  deriveEscrowConfigPda,
  deriveMerchantWalletPda,
  deriveOrderPda,
  deriveVaultPda,
  deriveReceiptConfigPda,
  deriveReceiptPda,
  deriveAssociatedTokenAddress,
  fetchAndDecodeAccount,
  fetchTokenAccountBalance,
  sendAndConfirmInstructions,
  buildFundInstruction,
  buildRefundInstruction,
  buildUserReleaseInstruction,
  buildCreateReceiptInstruction,
  ORDER_ESCROW_IDL,
  type SolanaEnvConfig,
  type VerificationFlags,
} from "@merchantmesh/shared";
import { nowSec, type BridgeDb } from "./db.js";

export type EscrowState = "Funded" | "Preparing" | "Ready" | "Released" | "Refunded" | "Disputed";
const ESCROW_STATE_NAMES: EscrowState[] = ["Funded", "Preparing", "Ready", "Released", "Refunded", "Disputed"];

export interface EscrowInfo {
  escrowOrderId: number;
  merchantId: number;
  merchantSlug: string;
  buyer: string;
  amountMicroUsdc: number;
  quoteHash: string;
  pickupCodeHash: string;
  fundedAt: number;
  releaseDeadline: number;
  state: EscrowState;
  fundTx: string;
  releaseTx: string | null;
}

export interface FundParams {
  merchantId: number;
  merchantSlug: string;
  buyer: string;
  amountMicroUsdc: number;
  quoteHash: string;
  pickupCodeHash: string;
  releaseDeadline: number;
}

export interface ReceiptParams {
  taskRef: string;
  totalResearchMicroUsdc: number;
  totalMainMicroUsdc: number;
  completedItems: number;
  totalItems: number;
  metadataURI: string;
  metadataHash: string;
}

/**
 * ChainProvider — everything the agent needs from the chain:
 * order_escrow + order_receipt + merchant identity lookups.
 */
export interface ChainProvider {
  readonly mode: "mock" | "solana";
  walletAddress(): string;
  /** Async because the real implementation is an RPC call; mock resolves synchronously. */
  walletBalanceMicroUsdc(): Promise<number>;
  fund(params: FundParams): Promise<{ escrowOrderId: number; txRef: string }>;
  markPreparing(escrowOrderId: number): Promise<{ txRef: string }>;
  markReady(escrowOrderId: number): Promise<{ txRef: string }>;
  confirmPickup(escrowOrderId: number, code: string): Promise<{ txRef: string; released: boolean }>;
  refund(escrowOrderId: number, reason: string): Promise<{ txRef: string }>;
  userRelease(escrowOrderId: number): Promise<{ txRef: string }>;
  getEscrow(escrowOrderId: number): Promise<EscrowInfo | undefined>;
  createReceipt(params: ReceiptParams): Promise<{ receiptId: number; txRef: string }>;
  identityCheck(agentId: number): Promise<VerificationFlags>;
  postFeedback(agentId: number, score: number, tags: string[], evidenceURI: string): Promise<{ txRef: string }>;
}

function mockTx(): string {
  return `mock:${randomBytes(16).toString("hex")}`;
}

const INITIAL_WALLET_MICRO = 25_000_000; // 25 USDC session wallet in mock mode

/**
 * MockChainProvider — simulates order_escrow, order_receipt, and merchant
 * identity in the bridge's SQLite. Merchant agents interact with it through
 * the bridge's /chain/* endpoints, exactly as they would submit txs.
 */
export class MockChainProvider implements ChainProvider {
  readonly mode = "mock" as const;

  constructor(
    private db: BridgeDb,
    /** DEMO_FAIL_SHOP: escrow funding for these slugs reverts (scripted saga demo). */
    private failSlugs: Set<string> = new Set(),
  ) {
    const wallet = db.prepare("SELECT * FROM chain_wallet WHERE id = 1").get();
    if (!wallet) {
      db.prepare("INSERT INTO chain_wallet (id, address, balance_micro) VALUES (1, ?, ?)").run(
        devAddress(BUYER_KEY_INDEX),
        INITIAL_WALLET_MICRO,
      );
    }
  }

  walletAddress(): string {
    return (this.db.prepare("SELECT address FROM chain_wallet WHERE id = 1").get() as { address: string }).address;
  }

  async walletBalanceMicroUsdc(): Promise<number> {
    return (this.db.prepare("SELECT balance_micro FROM chain_wallet WHERE id = 1").get() as { balance_micro: number })
      .balance_micro;
  }

  private debit(amount: number): void {
    const balance = (this.db.prepare("SELECT balance_micro FROM chain_wallet WHERE id = 1").get() as { balance_micro: number })
      .balance_micro;
    if (balance < amount) throw new Error(`SPL transfer amount exceeds balance (${balance} < ${amount})`);
    this.db.prepare("UPDATE chain_wallet SET balance_micro = balance_micro - ? WHERE id = 1").run(amount);
  }

  private credit(amount: number): void {
    this.db.prepare("UPDATE chain_wallet SET balance_micro = balance_micro + ? WHERE id = 1").run(amount);
  }

  async fund(params: FundParams): Promise<{ escrowOrderId: number; txRef: string }> {
    if (this.failSlugs.has(params.merchantSlug)) {
      throw new Error(`transaction simulation failed: SPL transfer failed (scripted DEMO_FAIL_SHOP=${params.merchantSlug})`);
    }
    this.debit(params.amountMicroUsdc);
    const txRef = mockTx();
    const result = this.db
      .prepare(
        `INSERT INTO chain_escrows (merchant_id, merchant_slug, buyer, amount_micro, quote_hash, pickup_code_hash,
          funded_at, release_deadline, state, fund_tx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Funded', ?)`,
      )
      .run(
        params.merchantId, params.merchantSlug, params.buyer, params.amountMicroUsdc,
        params.quoteHash, params.pickupCodeHash, nowSec(), params.releaseDeadline, txRef,
      );
    return { escrowOrderId: Number(result.lastInsertRowid), txRef };
  }

  async getEscrow(escrowOrderId: number): Promise<EscrowInfo | undefined> {
    const row = this.db.prepare("SELECT * FROM chain_escrows WHERE escrow_order_id = ?").get(escrowOrderId) as any;
    if (!row) return undefined;
    return {
      escrowOrderId: row.escrow_order_id,
      merchantId: row.merchant_id,
      merchantSlug: row.merchant_slug,
      buyer: row.buyer,
      amountMicroUsdc: row.amount_micro,
      quoteHash: row.quote_hash,
      pickupCodeHash: row.pickup_code_hash,
      fundedAt: row.funded_at,
      releaseDeadline: row.release_deadline,
      state: row.state,
      fundTx: row.fund_tx,
      releaseTx: row.release_tx,
    };
  }

  private setState(escrowOrderId: number, state: EscrowState, releaseTx?: string): void {
    if (releaseTx) {
      this.db.prepare("UPDATE chain_escrows SET state = ?, release_tx = ? WHERE escrow_order_id = ?").run(state, releaseTx, escrowOrderId);
    } else {
      this.db.prepare("UPDATE chain_escrows SET state = ? WHERE escrow_order_id = ?").run(state, escrowOrderId);
    }
  }

  private async mustGet(escrowOrderId: number): Promise<EscrowInfo> {
    const escrow = await this.getEscrow(escrowOrderId);
    if (!escrow) throw new Error(`escrow order not found: ${escrowOrderId}`);
    return escrow;
  }

  async markPreparing(escrowOrderId: number): Promise<{ txRef: string }> {
    const escrow = await this.mustGet(escrowOrderId);
    if (escrow.state !== "Funded") throw new Error(`invalid state for markPreparing: ${escrow.state}`);
    this.setState(escrowOrderId, "Preparing");
    return { txRef: mockTx() };
  }

  async markReady(escrowOrderId: number): Promise<{ txRef: string }> {
    const escrow = await this.mustGet(escrowOrderId);
    if (escrow.state !== "Preparing") throw new Error(`invalid state for markReady: ${escrow.state}`);
    this.setState(escrowOrderId, "Ready");
    return { txRef: mockTx() };
  }

  async confirmPickup(escrowOrderId: number, code: string): Promise<{ txRef: string; released: boolean }> {
    const escrow = await this.mustGet(escrowOrderId);
    if (escrow.state !== "Ready" && escrow.state !== "Preparing") {
      throw new Error(`invalid state for confirmPickup: ${escrow.state}`);
    }
    if (keccak256HexUtf8(code) !== escrow.pickupCodeHash) {
      throw new Error("pickup code mismatch");
    }
    const txRef = mockTx();
    this.setState(escrowOrderId, "Released", txRef); // merchant paid out
    return { txRef, released: true };
  }

  /** Buyer-cancel pre-Preparing, or anyone past releaseDeadline (timeouts). */
  async refund(escrowOrderId: number, _reason: string): Promise<{ txRef: string }> {
    const escrow = await this.mustGet(escrowOrderId);
    if (escrow.state === "Released" || escrow.state === "Refunded") {
      throw new Error(`escrow already settled: ${escrow.state}`);
    }
    const pastDeadline = nowSec() >= escrow.releaseDeadline;
    if (escrow.state !== "Funded" && !pastDeadline) {
      throw new Error("refund only allowed pre-Preparing or past the release deadline");
    }
    const txRef = mockTx();
    this.credit(escrow.amountMicroUsdc);
    this.setState(escrowOrderId, "Refunded", txRef);
    return { txRef };
  }

  /** Manual fallback release — buyer only, labeled as fallback in the UI. */
  async userRelease(escrowOrderId: number): Promise<{ txRef: string }> {
    const escrow = await this.mustGet(escrowOrderId);
    if (escrow.state === "Released" || escrow.state === "Refunded") {
      throw new Error(`escrow already settled: ${escrow.state}`);
    }
    const txRef = mockTx();
    this.setState(escrowOrderId, "Released", txRef);
    return { txRef };
  }

  async createReceipt(p: ReceiptParams): Promise<{ receiptId: number; txRef: string }> {
    const txRef = mockTx();
    const result = this.db
      .prepare(
        `INSERT INTO chain_receipts (task_ref, total_research_micro, total_main_micro, completed_items, total_items,
          metadata_uri, metadata_hash, tx_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.taskRef, p.totalResearchMicroUsdc, p.totalMainMicroUsdc, p.completedItems, p.totalItems,
        p.metadataURI, p.metadataHash, txRef, nowSec(),
      );
    return { receiptId: Number(result.lastInsertRowid), txRef };
  }

  /** Identity lookup — seeded flags in mock mode. */
  async identityCheck(agentId: number): Promise<VerificationFlags> {
    const seed = SEED_MERCHANTS.find((m) => m.agentId === agentId);
    return seed?.verification ?? { identity: false, attestation: false, stake: false };
  }

  async postFeedback(agentId: number, score: number, tags: string[], evidenceURI: string): Promise<{ txRef: string }> {
    const txRef = mockTx();
    this.db
      .prepare("INSERT INTO chain_feedback (agent_id, score, tags_json, evidence_uri, tx_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(agentId, score, JSON.stringify(tags), evidenceURI, txRef, nowSec());
    return { txRef };
  }
}

// ---------------------------------------------------------------------------
// SolanaChainProvider — real chain (devnet by default; cluster-generic via env)
// ---------------------------------------------------------------------------

interface DecodedOrder {
  order_id: bigint;
  merchant_id: bigint;
  buyer: Address;
  amount: bigint;
  quote_hash: Uint8Array;
  pickup_code_hash: Uint8Array;
  funded_at: bigint;
  release_deadline: bigint;
  state: number;
}
interface DecodedEscrowConfig {
  authority: Address;
  arbiter: Address;
  usdc_mint: Address;
  next_order_id: bigint;
}
interface DecodedMerchantWallet {
  merchant_id: bigint;
  wallet: Address;
}
interface DecodedReceiptConfig {
  authority: Address;
  relayer: Address;
  next_receipt_id: bigint;
}

/**
 * Real-mode ChainProvider. Talks to the deployed order_escrow/order_receipt
 * programs with the relayer's key (see /solana).
 *
 * IMPORTANT (ported from the Faz B EVM smoke test — see DECISIONS.md):
 * `fund()` here signs and submits the escrow funding transaction with the
 * RELAYER's own key — this proves the on-chain flow end-to-end
 * (chain-smoke.ts) before Faz I moves real fund-signing to the buyer's
 * connected wallet in the browser. Once Faz I lands, this method's role
 * changes from "sign and submit" to "verify a signature the frontend
 * already submitted".
 *
 * `markPreparing`/`markReady`/`confirmPickup` are NOT called by the bridge in
 * real mode — only the merchant's own key can call them (the escrow program
 * checks the signer against `MerchantWallet.wallet`), which is
 * `SolanaMerchantChainClient`'s job (apps/merchant-agents/src/chainClient.ts),
 * not the bridge's. They throw here rather than silently doing nothing, so a
 * wiring mistake fails loudly.
 */
export class SolanaChainProvider implements ChainProvider {
  readonly mode = "solana" as const;
  private rpc: ReturnType<typeof createSolanaRpcClient>;
  private account: KeyPairSigner;
  private escrowConfigPda: Address | undefined;

  constructor(
    private cfg: SolanaEnvConfig,
    private relayer: KeyPairSigner,
    private usdcMint: Address,
    private minConfirmations: number,
  ) {
    this.rpc = createSolanaRpcClient(cfg);
    this.account = relayer;
    void this.minConfirmations; // confirmation depth isn't configurable via sendAndConfirmInstructions's polling wait; kept for parity with the old constructor shape
  }

  walletAddress(): string {
    return this.account.address;
  }

  private async escrowConfig(): Promise<Address> {
    if (!this.escrowConfigPda) [this.escrowConfigPda] = await deriveEscrowConfigPda();
    return this.escrowConfigPda;
  }

  async walletBalanceMicroUsdc(): Promise<number> {
    const ata = await deriveAssociatedTokenAddress(this.account.address, this.usdcMint);
    const balance = await fetchTokenAccountBalance(this.rpc, ata);
    return Number(balance); // USDC is 6 decimals — fits Number safely at test/demo scale
  }

  async fund(params: FundParams): Promise<{ escrowOrderId: number; txRef: string }> {
    const escrowConfigPda = await this.escrowConfig();
    const config = await fetchAndDecodeAccount<DecodedEscrowConfig>(this.rpc, ORDER_ESCROW_IDL, "EscrowConfig", escrowConfigPda);
    if (!config) throw new Error("escrow_config is not initialized on this cluster — run the /solana deploy/init script first");
    const orderId = config.next_order_id;

    const [order] = await deriveOrderPda(orderId);
    const [vault] = await deriveVaultPda(orderId);
    const [merchantWallet] = await deriveMerchantWalletPda(BigInt(params.merchantId));
    const buyerTokenAccount = await deriveAssociatedTokenAddress(this.account.address, this.usdcMint);

    const ix = buildFundInstruction(
      { buyer: this.account.address, escrowConfig: escrowConfigPda, merchantWallet, order, usdcMint: this.usdcMint, vault, buyerTokenAccount },
      {
        orderId,
        amount: BigInt(params.amountMicroUsdc),
        quoteHash: hexToBytes(params.quoteHash),
        pickupCodeHash: hexToBytes(params.pickupCodeHash),
        releaseDeadline: BigInt(params.releaseDeadline),
      },
    );
    const signature = await sendAndConfirmInstructions(this.rpc, this.account, [ix]);
    return { escrowOrderId: Number(orderId), txRef: signature };
  }

  async getEscrow(escrowOrderId: number): Promise<EscrowInfo | undefined> {
    const [order] = await deriveOrderPda(escrowOrderId);
    const decoded = await fetchAndDecodeAccount<DecodedOrder>(this.rpc, ORDER_ESCROW_IDL, "Order", order);
    if (!decoded) return undefined;
    return {
      escrowOrderId: Number(decoded.order_id),
      merchantId: Number(decoded.merchant_id),
      merchantSlug: "", // not tracked on-chain; callers that need it already have it from task_orders
      buyer: decoded.buyer,
      amountMicroUsdc: Number(decoded.amount),
      quoteHash: bytesToHex(decoded.quote_hash),
      pickupCodeHash: bytesToHex(decoded.pickup_code_hash),
      fundedAt: Number(decoded.funded_at),
      releaseDeadline: Number(decoded.release_deadline),
      state: ESCROW_STATE_NAMES[decoded.state] ?? "Funded",
      fundTx: "",
      releaseTx: null,
    };
  }

  async markPreparing(): Promise<{ txRef: string }> {
    throw new Error(
      "SolanaChainProvider.markPreparing is not callable in real mode — order_escrow requires the merchant's " +
        "own signer. Merchants call this via SolanaMerchantChainClient, not the bridge.",
    );
  }

  async markReady(): Promise<{ txRef: string }> {
    throw new Error("SolanaChainProvider.markReady is not callable in real mode — see markPreparing.");
  }

  async confirmPickup(): Promise<{ txRef: string; released: boolean }> {
    throw new Error("SolanaChainProvider.confirmPickup is not callable in real mode — see markPreparing.");
  }

  /** Buyer-cancel pre-Preparing, or anyone past releaseDeadline — the program enforces both. */
  async refund(escrowOrderId: number, _reason: string): Promise<{ txRef: string }> {
    const [order] = await deriveOrderPda(escrowOrderId);
    const [vault] = await deriveVaultPda(escrowOrderId);
    const decoded = await fetchAndDecodeAccount<DecodedOrder>(this.rpc, ORDER_ESCROW_IDL, "Order", order);
    if (!decoded) throw new Error(`escrow order not found: ${escrowOrderId}`);
    const buyerTokenAccount = await deriveAssociatedTokenAddress(decoded.buyer, this.usdcMint);

    const ix = buildRefundInstruction(
      { caller: this.account.address, order, vault, buyerTokenAccount, buyer: decoded.buyer },
      escrowOrderId,
    );
    const signature = await sendAndConfirmInstructions(this.rpc, this.account, [ix]);
    return { txRef: signature };
  }

  /** Manual fallback release. The program requires the buyer's own signature — Faz I moves the
   *  actual signing to the buyer's browser wallet; this relayer-signed path only works when the
   *  relayer itself is the recorded buyer (true for the Faz B smoke test's single test wallet). */
  async userRelease(escrowOrderId: number): Promise<{ txRef: string }> {
    const [order] = await deriveOrderPda(escrowOrderId);
    const [vault] = await deriveVaultPda(escrowOrderId);
    const decoded = await fetchAndDecodeAccount<DecodedOrder>(this.rpc, ORDER_ESCROW_IDL, "Order", order);
    if (!decoded) throw new Error(`escrow order not found: ${escrowOrderId}`);
    const [merchantWallet] = await deriveMerchantWalletPda(decoded.merchant_id);
    const merchantWalletAccount = await fetchAndDecodeAccount<DecodedMerchantWallet>(this.rpc, ORDER_ESCROW_IDL, "MerchantWallet", merchantWallet);
    if (!merchantWalletAccount) throw new Error(`merchant_wallet not registered for merchant ${decoded.merchant_id}`);
    const merchantTokenAccount = await deriveAssociatedTokenAddress(merchantWalletAccount.wallet, this.usdcMint);

    const ix = buildUserReleaseInstruction(
      { buyer: this.account.address, order, vault, merchantWallet, merchantTokenAccount },
      escrowOrderId,
    );
    const signature = await sendAndConfirmInstructions(this.rpc, this.account, [ix]);
    return { txRef: signature };
  }

  async createReceipt(p: ReceiptParams): Promise<{ receiptId: number; txRef: string }> {
    const [receiptConfigPda] = await deriveReceiptConfigPda();
    const config = await fetchAndDecodeAccount<DecodedReceiptConfig>(this.rpc, ORDER_ESCROW_IDL, "ReceiptConfig", receiptConfigPda);
    if (!config) throw new Error("receipt_config is not initialized on this cluster — run the /solana deploy/init script first");
    const receiptId = config.next_receipt_id;
    const [receipt] = await deriveReceiptPda(receiptId);

    const ix = buildCreateReceiptInstruction(
      { relayer: this.account.address, receiptConfig: receiptConfigPda, receipt },
      {
        receiptId,
        taskRef: p.taskRef,
        totalResearchMicroUsdc: BigInt(p.totalResearchMicroUsdc),
        totalMainMicroUsdc: BigInt(p.totalMainMicroUsdc),
        completedItems: BigInt(p.completedItems),
        totalItems: BigInt(p.totalItems),
        metadataUri: p.metadataURI,
        metadataHash: hexToBytes(p.metadataHash),
      },
    );
    const signature = await sendAndConfirmInstructions(this.rpc, this.account, [ix]);
    return { receiptId: Number(receiptId), txRef: signature };
  }

  /** No external identity registry deployed by this project — seeded flags, same as mock. */
  async identityCheck(agentId: number): Promise<VerificationFlags> {
    const seed = SEED_MERCHANTS.find((m) => m.agentId === agentId);
    return seed?.verification ?? { identity: false, attestation: false, stake: false };
  }

  /** No on-chain reputation registry wired yet — logged locally, not posted on-chain. */
  async postFeedback(agentId: number, score: number, tags: string[], evidenceURI: string): Promise<{ txRef: string }> {
    console.warn(
      `[bridge] postFeedback(agent=${agentId}, score=${score}, tags=${tags.join(",")}, ${evidenceURI}) — ` +
        "no reputation registry deployed, feedback not posted on-chain.",
    );
    return { txRef: "not-posted:reputation-registry-unset" };
  }
}

/**
 * Real-mode factory. Degrades to MockChainProvider with a console warning if
 * required env is missing — mock mode stays the reliable demo path. See
 * plans/faz-b.md for the real values once /solana is deployed to devnet.
 */
export async function createChainProvider(db: BridgeDb, failSlugs: Set<string>): Promise<ChainProvider> {
  const mockChain = (process.env.MOCK_CHAIN ?? "true") !== "false";
  if (mockChain) return new MockChainProvider(db, failSlugs);

  const required = ["SOLANA_RPC_URL", "RELAYER_PRIVATE_KEY", "USDC_MINT"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(`[bridge] MOCK_CHAIN=false but missing env: ${missing.join(", ")} — degrading to MockChainProvider.`);
    return new MockChainProvider(db, failSlugs);
  }
  const relayer = await createKeyPairSignerFromPrivateKeyBytes(hexToBytes(process.env.RELAYER_PRIVATE_KEY!));
  return new SolanaChainProvider(
    readSolanaEnvConfig(),
    relayer,
    address(process.env.USDC_MINT!),
    Number(process.env.CHAIN_MIN_CONFIRMATIONS ?? "1"),
  );
}
