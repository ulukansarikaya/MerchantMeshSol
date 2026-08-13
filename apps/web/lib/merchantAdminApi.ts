import { PLATFORM_API_URL } from "./platformApi";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

function req<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(`${PLATFORM_API_URL}${path}`, {
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  }).then((r) => json<T>(r));
}

export interface MerchantSummary {
  id: string;
  slug: string;
  name: string;
  category: string;
  status: string;
  runtime: string;
  active: boolean;
  onChainMerchantId: string | null;
  role: string;
}

export interface MerchantDetail {
  id: string;
  slug: string;
  name: string;
  category: string;
  status: string;
  runtime: string;
  active: boolean;
  onChainMerchantId: string | null;
  endpointUri: string | null;
  serviceRadiusM: number | null;
  agentStrategy: string | null;
  pricingPolicyVersion: string;
}

export interface ProductRow {
  id: string;
  canonicalSku: string;
  merchantProductName: string;
  basePriceMicroUsdc: string;
  minimumPriceMicroUsdc: string;
  costMicroUsdc: string | null;
  minMarginMicroUsdc: string | null;
  maxDiscountBps: number | null;
  lowStockBehavior: string;
  active: boolean;
}

export interface InventoryLine {
  merchantProductId: string;
  sku: string;
  name: string;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
}

export interface PricingDecisionRow {
  id: string;
  model: string;
  baseTotalMicroUsdc: string;
  discountMicroUsdc: string;
  finalTotalMicroUsdc: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  llmOutputJson: { rationale?: string; proposedDiscountBps?: number } | null;
  createdAt: string;
}

export interface AdminMerchantRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  status: string;
  active: boolean;
  onChainMerchantId: string | null;
  createdAt: string;
}

export type DisputeStatus = "open" | "reviewing" | "refunded" | "released" | "closed";

export interface DisputeRow {
  id: string;
  taskOrderId: string;
  merchantId: string;
  raisedByAccountId: string;
  status: DisputeStatus;
  reason: string;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantDisputeRow extends DisputeRow {
  taskId: string;
}

export interface CampaignRule {
  id: string;
  ruleType: string;
  discountType: "percent" | "fixed";
  discountValue: string;
  maximumDiscountMicroUsdc: string | null;
}

export interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startAt: string | null;
  endAt: string | null;
  stackPolicy: string;
  priority: number;
  rules: CampaignRule[];
}

export interface TaskOrderRow {
  id: string;
  taskId: string;
  merchantId: string;
  state: string;
  totalMicroUsdc: string;
}

export const CAMPAIGN_RULE_TYPES = ["percent_off", "fixed_off"] as const;

export const merchantAdminApi = {
  create: (body: { slug: string; name: string; category: string; lat: number; lng: number }) =>
    req<{ ok: true; merchantId: string; walletAddress: string }>("/merchant-agents", { method: "POST", body: JSON.stringify(body) }),

  mine: () => req<{ merchants: MerchantSummary[] }>("/merchant-agents/mine"),

  get: (id: string) => req<{ merchant: MerchantDetail }>(`/merchant-agents/${id}`),

  update: (id: string, body: Record<string, unknown>) =>
    req<{ ok: true }>(`/merchant-agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  publish: (id: string) => req<{ ok: true; onChainMerchantId: string }>(`/merchant-agents/${id}/publish`, { method: "POST" }),

  decisions: (id: string) => req<{ decisions: PricingDecisionRow[] }>(`/merchant-agents/${id}/decisions`),

  products: (id: string) => req<{ products: ProductRow[] }>(`/merchant-agents/${id}/products`),

  createProduct: (
    id: string,
    body: {
      canonicalSku: string;
      merchantProductName: string;
      unitType: string;
      basePriceMicroUsdc: string;
      minimumPriceMicroUsdc: string;
      initialStock: number;
    },
  ) => req<{ ok: true; merchantProductId: string }>(`/merchant-agents/${id}/products`, { method: "POST", body: JSON.stringify(body) }),

  updateProduct: (id: string, productId: string, body: Record<string, unknown>) =>
    req<{ ok: true }>(`/merchant-agents/${id}/products/${productId}`, { method: "PATCH", body: JSON.stringify(body) }),

  deleteProduct: (id: string, productId: string) =>
    req<{ ok: true }>(`/merchant-agents/${id}/products/${productId}`, { method: "DELETE" }),

  inventory: (id: string) => req<{ inventory: InventoryLine[] }>(`/merchant-agents/${id}/inventory`),

  adjustInventory: (id: string, body: { merchantProductId: string; delta: number; movementType: string; note?: string }) =>
    req<{ ok: true }>(`/merchant-agents/${id}/inventory/adjust`, { method: "POST", body: JSON.stringify(body) }),

  pricingPolicies: (id: string) =>
    req<{ merchantWide: { pricingPolicyVersion: string }; perSku: { sku: string; minMarginMicroUsdc: string | null; maxDiscountBps: number | null; lowStockBehavior: string }[] }>(
      `/merchant-agents/${id}/pricing-policies`,
    ),

  updatePricingPolicy: (id: string, sku: string, body: Record<string, unknown>) =>
    req<{ ok: true }>(`/merchant-agents/${id}/pricing-policies/${sku}`, { method: "PUT", body: JSON.stringify(body) }),

  // Campaigns
  campaigns: (id: string) => req<{ campaigns: CampaignRow[] }>(`/merchant-agents/${id}/campaigns`),

  createCampaign: (
    id: string,
    body: {
      name: string;
      description?: string;
      startAt?: string;
      endAt?: string;
      stackPolicy?: "exclusive" | "stackable";
      rule: { ruleType: "percent_off" | "fixed_off"; discountType: "percent" | "fixed"; discountValue: string; maximumDiscountMicroUsdc?: string };
    },
  ) => req<{ ok: true; campaignId: string }>(`/merchant-agents/${id}/campaigns`, { method: "POST", body: JSON.stringify(body) }),

  updateCampaign: (id: string, campaignId: string, body: { status?: string; name?: string; description?: string }) =>
    req<{ ok: true }>(`/merchant-agents/${id}/campaigns/${campaignId}`, { method: "PATCH", body: JSON.stringify(body) }),

  // Disputes — merchant-scoped read (this merchant's own) and customer-facing open
  merchantDisputes: (id: string) => req<{ disputes: MerchantDisputeRow[] }>(`/merchant-agents/${id}/disputes`),

  taskOrders: (taskId: string) => req<{ orders: TaskOrderRow[] }>(`/shopping/tasks/${taskId}/orders`),

  openDispute: (taskId: string, orderId: string, reason: string) =>
    req<{ ok: true; disputeId: string }>(`/shopping/tasks/${taskId}/orders/${orderId}/dispute`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  // Operator admin surface
  adminMerchants: () => req<{ merchants: AdminMerchantRow[] }>("/admin/merchants"),

  suspend: (id: string) => req<{ ok: true }>(`/merchant-agents/${id}/suspend`, { method: "POST" }),

  activate: (id: string) => req<{ ok: true }>(`/merchant-agents/${id}/activate`, { method: "POST" }),

  adminDisputes: () => req<{ disputes: { dispute: DisputeRow; taskOrder: TaskOrderRow }[] }>("/admin/disputes"),

  reviewDispute: (disputeId: string) => req<{ ok: true }>(`/admin/disputes/${disputeId}/review`, { method: "POST" }),

  resolveDispute: (disputeId: string, outcome: "refund" | "release", resolution?: string) =>
    req<{ ok: true; txSignature: string }>(`/admin/disputes/${disputeId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ outcome, resolution }),
    }),

  closeDispute: (disputeId: string) => req<{ ok: true }>(`/admin/disputes/${disputeId}/close`, { method: "POST" }),
};
