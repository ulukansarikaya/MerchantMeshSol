// Subpath export ("@merchantmesh/shared/sessionAuth") — pulls in `hono`, so
// kept out of the main barrel to keep the web bundle from picking it up.
import type { Context, MiddlewareHandler } from "hono";

export interface SessionAccount {
  accountId: string;
  walletAddress: string;
}

/**
 * DI seam: packages/shared has no Postgres dependency, so the actual
 * sessions-table lookup is injected by the caller (platform-api, bridge,
 * merchant-agents each pass a lookup backed by @merchantmesh/db). See
 * plans/faz-c.md §1 — "servisler arası ekstra HTTP çağrısı yok".
 */
export type SessionLookup = (token: string) => Promise<SessionAccount | null>;

export const SESSION_COOKIE_NAME = "mm_session";

function extractToken(c: Context): string | undefined {
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  const cookie = c.req.header("cookie");
  if (!cookie) return undefined;
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`).exec(cookie);
  return match?.[1];
}

type SessionEnv = { Variables: { accountId: string; walletAddress: string } };

/**
 * Session-gated middleware. Reads the token from the `mm_session` cookie or
 * an `Authorization: Bearer` header (the latter for e2e/Postman tests per
 * plans/faz-c.md §4), verifies via the injected lookup, and sets
 * `accountId`/`walletAddress` in context. 401s when no valid session and
 * `required` (default true).
 */
export function createSessionMiddleware(lookup: SessionLookup, opts: { required?: boolean } = {}): MiddlewareHandler<SessionEnv> {
  const required = opts.required ?? true;
  return async (c, next) => {
    const token = extractToken(c);
    const account = token ? await lookup(token) : null;
    if (!account) {
      if (required) return c.json({ error: "unauthorized" }, 401);
      await next();
      return;
    }
    c.set("accountId", account.accountId);
    c.set("walletAddress", account.walletAddress);
    await next();
  };
}
