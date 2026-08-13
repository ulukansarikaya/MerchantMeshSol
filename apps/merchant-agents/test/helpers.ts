import { randomUUID } from "node:crypto";
import {
  ENDPOINT_PRICES_MICRO,
  seedMerchantBySlug,
  type PaidEndpoint,
  type MerchantPublic,
} from "@merchantmesh/shared";
import { encodeProofHeader, signMockProof, X_PAYMENT_HEADER } from "@merchantmesh/shared/mockpay";
import { openDb, seedDb } from "../src/db.js";
import { createMerchantApp } from "../src/app.js";
import type { MerchantChainClient } from "../src/chainClient.js";
import { MockDiscountProvider } from "../src/discountProvider.js";

export const TEST_SECRET = "test-secret";

export class FakeChain implements MerchantChainClient {
  calls: string[] = [];
  async markPreparing(id: number) {
    this.calls.push(`markPreparing:${id}`);
    return { txRef: `mock:prep${id}` };
  }
  async markReady(id: number) {
    this.calls.push(`markReady:${id}`);
    return { txRef: `mock:ready${id}` };
  }
  async confirmPickup(id: number, code: string) {
    this.calls.push(`confirmPickup:${id}:${code}`);
    return { txRef: `mock:release${id}`, released: true };
  }
}

export async function createTestApp(overrides: Partial<Parameters<typeof createMerchantApp>[0]> = {}) {
  const db = openDb(":memory:");
  await seedDb(db, false); // false: ignore any real MERCHANT_*_PRIVATE_KEY in env, use deterministic dev keys
  const chain = new FakeChain();
  const { app, worker } = createMerchantApp({
    db,
    chain,
    mockPayments: true,
    mockSecret: TEST_SECRET,
    bridgeUrl: "http://localhost:0",
    notifyBridge: false,
    chainName: "mock",
    usdcAsset: "USDC",
    prepTimeoutSecs: 1,
    autoPrepareDelayMs: 1,
    discountProvider: new MockDiscountProvider(),
    ...overrides,
  });
  return { app, db, chain, worker };
}

/** Build the headers for a fully paid request against a merchant endpoint. */
export function paidHeaders(
  endpoint: PaidEndpoint,
  merchant: Pick<MerchantPublic, "slug" | "wallet">,
  idempotencyKey: string = `idem_${randomUUID()}`,
): Record<string, string> {
  const proof = signMockProof(TEST_SECRET, {
    paymentId: `pay_${randomUUID()}`,
    taskId: "t_test",
    amountMicroUsdc: ENDPOINT_PRICES_MICRO[endpoint],
    payTo: merchant.wallet,
    endpoint: `/merchant/${merchant.slug}/${endpoint}`,
    idempotencyKey,
    issuedAt: Math.floor(Date.now() / 1000),
    provider: "mock",
  });
  return {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    [X_PAYMENT_HEADER]: encodeProofHeader(proof),
  };
}

// Real dev wallet addresses, matching what seedDb(db, false) actually derives
// for each merchant (devSignerKey -> address), so tests sign against the
// same wallets the app records.
export const ALI = { slug: "ali-kasap", wallet: seedMerchantBySlug("ali-kasap").wallet } as const;
export const ZEYNEP = { slug: "zeynep-manav", wallet: seedMerchantBySlug("zeynep-manav").wallet } as const;
export const CEM = { slug: "cem-firin", wallet: seedMerchantBySlug("cem-firin").wallet } as const;
export const MINI = { slug: "mini-market", wallet: seedMerchantBySlug("mini-market").wallet } as const;
