/**
 * Same-origin Solana JSON-RPC proxy.
 *
 * The browser can't talk to the project's real RPC provider directly: the
 * endpoint carries an API key, and `NEXT_PUBLIC_*` is the only thing Next.js
 * inlines into the client bundle, so pointing the browser at it would publish
 * the key to anyone who opens devtools. Sending the browser to the public
 * `api.devnet.solana.com` instead trades the leak for rate limits — funding
 * several escrows in one go reliably trips its 429.
 *
 * So the browser posts here, and this route (server-side, where the
 * unprefixed env var is readable) forwards to the real provider. The request
 * body is passed through untouched, which keeps batch JSON-RPC arrays working.
 */
const UPSTREAM = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    });
  } catch (cause) {
    // Network-level failure: answer in JSON-RPC's own error shape so the
    // caller surfaces a useful message instead of a JSON parse error.
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: `RPC upstream unreachable: ${(cause as Error).message}` } },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
