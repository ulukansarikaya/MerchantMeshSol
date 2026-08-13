"use client";

import Link from "next/link";
import { useSession } from "../lib/useSession";

/** Only rendered for signed-in operator accounts — keeps layout.tsx a server component while the operator check itself needs the client-side session. */
export function AdminNavLink() {
  const { account } = useSession();
  if (!account?.isOperator) return null;
  return (
    <Link href="/admin" className="hover:text-ink">
      Admin
    </Link>
  );
}
