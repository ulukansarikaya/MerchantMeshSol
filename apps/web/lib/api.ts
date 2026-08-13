export const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL ?? "http://localhost:3001";
export const MERCHANTS_URL = process.env.NEXT_PUBLIC_MERCHANTS_URL ?? "http://localhost:4000";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  createTask: (prompt: string) =>
    fetch(`${BRIDGE_URL}/tasks`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    }).then((r) => json<{ taskId: string }>(r)),

  task: (taskId: string) => fetch(`${BRIDGE_URL}/tasks/${taskId}`, { credentials: "include" }).then((r) => json<any>(r)),

  refinePlan: (taskId: string, message: string) =>
    fetch(`${BRIDGE_URL}/tasks/${taskId}/refine-plan`, {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
    }).then((r) => json<any>(r)),

  approvePlan: (taskId: string, selectedIndices: number[]) =>
    fetch(`${BRIDGE_URL}/tasks/${taskId}/approve-plan`, {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedIndices }),
    }).then((r) => json<any>(r)),

  spend: (taskId: string) => fetch(`${BRIDGE_URL}/tasks/${taskId}/spend`, { credentials: "include" }).then((r) => json<any>(r)),

  wallet: () => fetch(`${BRIDGE_URL}/wallet`).then((r) => json<any>(r)),

  selectOption: (taskId: string, option: string) =>
    fetch(`${BRIDGE_URL}/tasks/${taskId}/select-option`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ option }),
    }).then((r) => json<any>(r)),

  approvePayment: (taskId: string) =>
    fetch(`${BRIDGE_URL}/tasks/${taskId}/approve-payment`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).then((r) => json<any>(r)),

  cancelTask: (taskId: string) =>
    fetch(`${BRIDGE_URL}/tasks/${taskId}/cancel`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).then((r) => json<any>(r)),

  userRelease: (taskId: string, orderId: string) =>
    fetch(`${BRIDGE_URL}/tasks/${taskId}/user-release`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId }),
    }).then((r) => json<any>(r)),

  feedback: (taskId: string, entries: { merchantId: number; score: number; tags: string[] }[]) =>
    fetch(`${BRIDGE_URL}/tasks/${taskId}/feedback`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries }),
    }).then((r) => json<any>(r)),

  eventsUrl: (taskId: string) => `${BRIDGE_URL}/tasks/${taskId}/events`,

  consoleOrders: () => fetch(`${MERCHANTS_URL}/console/orders`).then((r) => json<any>(r)),

  consoleMerchants: () => fetch(`${MERCHANTS_URL}/console/merchants`).then((r) => json<any>(r)),

  markReady: (slug: string, orderId: string) =>
    fetch(`${MERCHANTS_URL}/merchant/${slug}/ready`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId }),
    }).then((r) => json<any>(r)),

  verifyPickup: (slug: string, orderId: string, code: string) =>
    fetch(`${MERCHANTS_URL}/merchant/${slug}/verify-pickup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId, code }),
    }).then((r) => json<any>(r)),

  // Faz I §2/§3 — merchant acceptance console (Postgres path only; {acceptances:[]} in mock mode).
  consoleAcceptances: () => fetch(`${MERCHANTS_URL}/console/acceptances`).then((r) => json<any>(r)),

  acceptAcceptance: (acceptanceId: string) =>
    fetch(`${MERCHANTS_URL}/console/acceptances/${acceptanceId}/accept`, { method: "POST" }).then((r) => json<any>(r)),

  rejectAcceptance: (acceptanceId: string, reason?: string) =>
    fetch(`${MERCHANTS_URL}/console/acceptances/${acceptanceId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    }).then((r) => json<any>(r)),

  // Faz I §4 — funding wizard reports the tx it signed with the connected wallet.
  fundingTx: (taskId: string, orderId: string, escrowOrderId: number, txSignature: string) =>
    fetch(`${BRIDGE_URL}/tasks/${taskId}/funding-tx`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId, escrowOrderId, txSignature }),
    }).then((r) => json<any>(r)),

  releaseTx: (taskId: string, orderId: string, escrowOrderId: number, txSignature: string) =>
    fetch(`${BRIDGE_URL}/tasks/${taskId}/release-tx`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId, escrowOrderId, txSignature }),
    }).then((r) => json<any>(r)),
};
