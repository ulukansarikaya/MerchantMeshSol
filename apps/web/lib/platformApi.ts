export const PLATFORM_API_URL = process.env.NEXT_PUBLIC_PLATFORM_API_URL ?? "http://localhost:3002";

export interface AccountView {
  accountId: string;
  walletAddress: string;
  agentId: string;
  activeMode: "customer" | "merchant";
  isNewAccount: boolean;
  /** Only ever set (and trustworthy) on the /me response — see platformApi.me(). */
  isOperator?: boolean;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const platformApi = {
  nonce: () =>
    fetch(`${PLATFORM_API_URL}/auth/nonce`, { method: "POST", credentials: "include" }).then((r) =>
      json<{ nonce: string }>(r),
    ),

  verify: (message: string, signature: string, address: string) =>
    fetch(`${PLATFORM_API_URL}/auth/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature, address }),
    }).then((r) => json<{ ok: true; account: AccountView }>(r)),

  me: () =>
    fetch(`${PLATFORM_API_URL}/me`, { credentials: "include" }).then((r) => json<{ account: AccountView }>(r)),

  logout: () => fetch(`${PLATFORM_API_URL}/auth/logout`, { method: "POST", credentials: "include" }).then((r) => json<{ ok: true }>(r)),

  setMode: (mode: "customer" | "merchant") =>
    fetch(`${PLATFORM_API_URL}/me/mode`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    }).then((r) => json<{ ok: true; account: AccountView }>(r)),

  // Faz J §1/§4 — research session wallet (real, testnet-only micropayment signer).
  sessionWallet: () =>
    fetch(`${PLATFORM_API_URL}/session-wallet`, { credentials: "include" }).then((r) =>
      json<{
        address: string;
        balanceMicroUsdc: number;
        dailySpentMicroUsdc: number;
        frozen: boolean;
        limits: {
          maxBalanceMicroUsdc: number;
          perTaskMicroUsdc: number;
          perDayMicroUsdc: number;
          maxPaymentsPerTask: number;
          maxPaidMerchantsPerTask: number;
        };
      }>(r),
    ),

  withdrawSessionWallet: (to: string) =>
    fetch(`${PLATFORM_API_URL}/session-wallet/withdraw`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to }),
    }).then((r) => json<{ ok: true; amountMicroUsdc: number; txSignature: string | null }>(r)),
};
