"use client";

import { useSession, IS_MOCK } from "../../lib/useSession";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { account, loading } = useSession();

  if (IS_MOCK) {
    return (
      <div className="card p-4 text-sm text-muted">
        The operator panel is disabled in mock mode. Set <code>NEXT_PUBLIC_MOCK=false</code> and sign in with an operator wallet.
      </div>
    );
  }
  if (loading) return <div className="text-sm text-muted">Loading…</div>;
  if (!account) {
    return <div className="card p-4 text-sm text-muted">Sign in with your wallet to access the operator panel.</div>;
  }
  if (!account.isOperator) {
    return (
      <div className="card p-4 text-sm text-muted">
        This account is not on the operator allowlist (<code>PLATFORM_OPERATOR_ACCOUNT_IDS</code>).
      </div>
    );
  }
  return <div className="flex flex-col gap-6">{children}</div>;
}
