"use client";

import { useSession, IS_MOCK } from "../../lib/useSession";
import { platformApi } from "../../lib/platformApi";

export default function MerchantDashboardLayout({ children }: { children: React.ReactNode }) {
  const { account, loading, refresh } = useSession();

  if (IS_MOCK) {
    return (
      <div className="card p-4 text-sm text-muted">
        The merchant dashboard is disabled in mock mode. Set <code>NEXT_PUBLIC_MOCK=false</code> and sign in with your wallet.
      </div>
    );
  }
  if (loading) return <div className="text-sm text-muted">Loading…</div>;
  if (!account) {
    return <div className="card p-4 text-sm text-muted">Sign in with your wallet to access the merchant dashboard.</div>;
  }
  if (account.activeMode !== "merchant") {
    return (
      <div className="card flex items-center justify-between gap-4 p-4">
        <p className="text-sm text-muted">Switch your account to merchant mode to use this dashboard.</p>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await platformApi.setMode("merchant");
            refresh();
          }}
        >
          Switch to Merchant Mode
        </button>
      </div>
    );
  }
  return <div className="flex flex-col gap-6">{children}</div>;
}
