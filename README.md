# MerchantMesh — Local AI Shopping Agent on Solana

MVP presentation: [`docs/MerchantMesh-MVP-Deck.pptx`](docs/MerchantMesh-MVP-Deck.pptx)  
GitHub submission checklist: [`docs/MVP_SUBMISSION.md`](docs/MVP_SUBMISSION.md)

A local-first prototype: you write a Turkish meal/shopping request, a local AI agent turns it
into a shopping list, discovers nearby **merchant agents** by distance, **pays for every
merchant request** through an x402-style micropayment flow (hard-capped research budget),
negotiates and reserves where it helps, presents 2–3 options — and only **after your
approval** funds per-shop **on-chain Solana escrows** that are released by **pickup-code
verification** at the counter.

The chain layer is **Solana** (Anchor programs, deployed and verified on devnet). There is no
EVM/Foundry/viem/wagmi anywhere in this codebase — all chain code lives in `/solana` and
`packages/shared/src/solana`. (An earlier Solidity/Foundry prototype was fully superseded by
the Solana port and is not part of this repository.)

Everything runs end-to-end on localhost in mock mode (`MOCK_PAYMENTS=true`,
`MOCK_CHAIN=true`, `AI_PROVIDER=mock`) — no wallet, no RPC, no model required.

## Roadmap

MerchantMesh's MVP is web-first and pickup-only on purpose: the hackathon timeline favored
shipping a real, working Solana devnet demo over a bigger surface area. The underlying
primitives — **agent-to-agent micropayments, on-chain escrow, and verified completion** —
aren't specific to local grocery pickup, and the plan is to prove that out:

- **Native mobile app.** A local-commerce agent is fundamentally a mobile use case (you're
  walking to the shop, not sitting at a desk) — web was the deliberate scoping choice for the
  hackathon, not the end state. A React Native/Expo client reusing the same wallet-adapter and
  API layer is the next client target.
- **Courier delivery.** Same escrow model, different release trigger: instead of an in-person
  pickup code, a courier agent (itself a paid participant in the marketplace) confirms
  delivery via GPS + proof-of-delivery, and that confirmation releases the merchant's escrow.
- **Broader online shopping.** Today's merchant discovery is hyper-local (Haversine distance
  to nearby esnaf). The same paid-quote → negotiate → escrow → release pipeline generalizes to
  any online merchant catalog, not just neighborhood shops within walking distance.
- **Service marketplaces (e.g. ride-hailing).** The furthest-out extension: swap "goods
  pickup" for "service completion." A driver agent quotes a fare, the buyer approves, escrow
  funds, and release triggers on verified trip completion instead of a pickup code — the same
  three primitives, applied to a service instead of a product.

None of the above is implemented — this section is explicitly a roadmap, not a claim about
the current MVP.

## Quickstart

Requirements: **Node ≥ 23.4** (uses the built-in `node:sqlite`), **pnpm 9**.

```bash
pnpm i          # install workspace deps
pnpm db:seed    # seed 5 merchants + fund the simulated session wallet
pnpm demo       # headless köfte demo incl. the scripted mini-market failure
pnpm dev        # all four services: web :3000, platform-api :3002, bridge :3001, merchants :4000
```

`pnpm dev` always starts `platform-api` too, but it's a no-op for the mock demo above —
with `apps/web/.env.local`'s default `NEXT_PUBLIC_MOCK=true` and no `DATABASE_URL`, the web
app never calls it and the bridge never requires a session. See "Live-version wallet auth
(Faz C)" below for the real-mode Solana wallet login path.

Then open **http://localhost:3000**, keep the default prompt
(*"4 kişilik köfte yapacağım, gidip alacağım"*), press **Başlat**, watch the paid timeline,
pick an option, approve — then switch to **Esnaf Konsolu**, mark orders ready and enter the
pickup codes shown on the flow page. The unified receipt appears when every shop settles.

Other useful commands:

```bash
pnpm demo:timeout   # prep-timeout auto-refund demo (Cem Fırın never prepares)
pnpm test           # vitest: shared + db + bridge + merchant-agents + platform-api
pnpm typecheck      # strict TS across the workspace
```

## Live-version infrastructure (Faz A — optional, not needed for the mock demo)

The mock-mode path above (`node:sqlite`) needs none of this. It exists for the live-version
build, which layers accounts, agent memory, merchant catalogs and campaigns on
Postgres + PostGIS + pgvector, with Redis for ephemeral task state.

**Docker (the documented default):**

```bash
pnpm db:up          # docker compose -f docker-compose.dev.yml up -d (Postgres+PostGIS+pgvector, Redis)
pnpm db:generate    # regenerate SQL migrations from packages/db/src/schema after a schema change
pnpm db:migrate     # apply migrations/*.sql to DATABASE_URL
pnpm db:seed:pg     # migrate the 5-merchant seed into the relational model (idempotent)
pnpm db:down        # stop the containers
```

**No Docker?** Any Postgres 16+ with `postgis` and `pgvector` installed works — point
`DATABASE_URL` at it. On Windows, the stock EDB installer ships neither extension; the
easiest fix without touching the native install is a second Postgres inside WSL2 on a
different port (WSL2 forwards `localhost` to Windows automatically):

```bash
wsl.exe -d Ubuntu -- bash -c "sudo apt-get update -qq && sudo apt-get install -y -qq postgresql postgresql-contrib postgis postgresql-18-pgvector && sudo sed -i \"s/^port = 5432/port = 5433/\" /etc/postgresql/18/main/postgresql.conf && sudo sed -i \"s/^#listen_addresses.*/listen_addresses = '*'/\" /etc/postgresql/18/main/postgresql.conf && echo 'host all all 0.0.0.0/0 scram-sha-256' | sudo tee -a /etc/postgresql/18/main/pg_hba.conf && sudo service postgresql restart && sudo -u postgres psql -c \"ALTER USER postgres PASSWORD 'postgres';\" -c \"CREATE DATABASE merchantmesh;\" && sudo -u postgres psql -d merchantmesh -c 'CREATE EXTENSION postgis;' -c 'CREATE EXTENSION vector;'"
```

then set `DATABASE_URL=postgres://postgres:postgres@localhost:5433/merchantmesh`. Check your
Ubuntu release's actual `postgresql` version first (`apt-cache policy postgresql`) — the
`18` above may need to change.

Env vars: `DATABASE_URL`, `REDIS_URL` (see `.env.example`). Smoke tests in
`packages/db/test` skip themselves entirely when `DATABASE_URL` is unset, so `pnpm test`
never depends on a live Postgres.

## Live-version wallet auth (Faz C — optional, not needed for the mock demo)

Adds real Solana wallet login on top of Faz A's Postgres: a new `apps/platform-api` service
(`:3002`) issues nonces, verifies a Solana sign-in message's Ed25519 signature (there's no
standardized Sign-In-With-Solana parser in this dependency set, so it's a small fixed
plain-text message, built and re-parsed by hand — see `apps/web/components/WalletWidget.tsx`
and `apps/platform-api/src/app.ts`), and sets an httpOnly session cookie (`mm_session`)
shared by hostname with the bridge (`:3001`) — no extra proxying needed since browser
cookies aren't port-scoped. Once `DATABASE_URL` is set, the bridge starts requiring a
session for `/tasks*` and enforces per-account ownership (a task belonging to another
account 404s, not 403s — "don't reveal existence").

To try it with a real browser wallet (Phantom, Solflare, ...):

```bash
# apps/web/.env.local
NEXT_PUBLIC_MOCK=false
```

then `pnpm dev` and open http://localhost:3000 — the shopping flow is now gated behind a
"connect wallet" card. Click **Cüzdan Bağla**, pick your wallet, sign the sign-in message,
and `/me` fills in with your account + agent. This last step needs an actual wallet
extension and a live Postgres + Redis + `SOLANA_RPC_URL`, so treat it as a manual smoke
test before relying on real-mode auth.

Relevant env vars (see `.env.example`): `WEB_ORIGIN`, `PLATFORM_API_PORT`, and the web-side
mirrors `NEXT_PUBLIC_PLATFORM_API_URL` / `NEXT_PUBLIC_SOLANA_*` (Next.js only inlines
`NEXT_PUBLIC_*`-prefixed vars into the browser bundle, so these duplicate the root
`SOLANA_*` values by hand — see `apps/web/lib/solanaConfig.ts`). `/auth/*` is rate-limited
to 10 req/min/IP via Redis when `REDIS_URL` is set (disabled with a startup warning
otherwise).

## Live-version merchant acceptance + funding (Faz I — optional, not needed for the mock demo)

The real merchant acceptance window (`merchant_pending → merchant_confirmed`) and the
funding wizard that lets the user's own connected wallet sign the Solana `fund` instruction.
Only active when `DATABASE_URL` is set — the mock path (bridge fast-forwards straight to
escrow) is completely unchanged otherwise.

- `apps/merchant-agents`'s catalog/inventory/reservations move to Postgres behind a
  `MerchantStore` interface (`SqliteMerchantStore` for every existing test,
  `PostgresMerchantStore` when `DATABASE_URL` is set) — reservations are atomic
  (`UPDATE ... WHERE available_quantity >= qty`, race-safe under concurrent requests).
- New merchant console endpoints: `GET /console/acceptances`,
  `POST /console/acceptances/:id/accept`, `POST /console/acceptances/:id/reject`
  (`apps/web/app/merchant`'s "Bekleyen Kabuller" section polls these every 3s and plays a
  repeating `public/notify.wav` chime — mute button included).
- Bridge: `POST /tasks/:id/select-option` + `/approve-payment` open a real acceptance
  window per shop (Postgres path); rejections run the same alternative-merchant/drop/
  cancel saga as the mock path. Once every shop is `merchant_confirmed`, escrow rows are
  created (pickup code generated here, not earlier) and `funding_ready` fires over SSE.
- `POST /tasks/:id/funding-tx` — the browser reports the Solana transaction signature it
  just signed for `order_escrow.fund`; the bridge only ever **verifies** it against on-chain
  state (`chain.getEscrow`), never signs on the user's behalf.

Verified end-to-end against a live Postgres with `MockChainProvider` (2 shops accept, 1
rejects → alternative-merchant saga → fund → verify → merchant prepares → ready → pickup →
escrow released — see `apps/local-agent-bridge/test/acceptance.test.ts`, skipped unless
`DATABASE_URL` is set; re-run `pnpm db:seed:pg` first if cem-firin's 2-unit ekmek stock has
been drained by earlier runs), and also **verified against real Solana devnet**: `pnpm
chain:smoke` (`scripts/chain-smoke.ts`) drives the deployed `order_escrow` program through
fund → markPreparing → markReady → confirmPickup, a wrong-pickup-code rejection, and a
past-deadline refund, all as real signed devnet transactions.

## Live-version real payments (Faz J — optional, not needed for the mock demo)

Every research micro-payment (quote-basket, negotiate, reserve) becomes a real USDC (SPL
Token) transfer, signed by a per-account **session wallet** — never a shared/bridge-operated
key. Only active when `MOCK_PAYMENTS=false` (requires `DATABASE_URL` + `REDIS_URL`); the
mock HMAC path is completely unchanged otherwise.

- `platform-api`: `GET /session-wallet` (creates one on first use, AES-256-GCM-encrypted
  with `SESSION_WALLET_MASTER_KEY`, never logged in cleartext), `POST /session-wallet/withdraw`
  (only ever to the account's own registered wallet — never an arbitrary address).
- `apps/web`: a "research wallet" card (top of the flow page in real mode) — the connected
  wallet sends USDC straight to the session wallet address; starting a task is blocked while
  it's empty.
- Bridge's real payment provider enforces every limit (task budget, per-request cap, payment
  count, distinct-merchant count, the wallet's own rolling 24h cap) **before** broadcasting
  anything — a transfer that lands on-chain can't be undone, so budget checks never happen
  after the fact.
- `apps/merchant-agents`' real-mode `paymentGate` verifies the proof by reading the
  transaction back from the chain itself (`getTransaction(..., {encoding: "jsonParsed"})`,
  decoding the SPL Token transfer instruction's amount/destination) rather than trusting the
  payer's claim; replay-protected via Postgres `payment_proofs UNIQUE` constraint.
- `POST /merchant/:id/quote-basket` replaces `quote` in the orchestrator's own pipeline
  (bundles stock/price/signed-quote/quality/prep-time/reservation-eligibility into one paid
  call — the separate paid `ask`(quality) call is gone from the pipeline). `order` is free
  now (Faz I's acceptance flow already creates orders without it).
- `pnpm ledger:check` (`scripts/ledger-check.ts`) reconciles `payment_events` against the
  actual on-chain USDC transfers each session wallet sent — a mismatch exits non-zero.

Verified: AES-256-GCM encrypt/decrypt round-trip (`packages/shared/test/sessionWalletCrypto.test.ts`)
and the full session-wallet lifecycle against live Postgres (creation, ownership lookup,
daily-spend accumulation, frozen-wallet rejection); payment verification logic is exercised
through `MockChainProvider` in the mock-mode test suite (same code paths real-mode uses).

## Merchant self-service + LLM-assisted pricing (Faz 2/3 — optional, not needed for the mock demo)

On top of the 5 fixed seed merchants, any signed-in account can create its own merchant,
add products/inventory, and (once an operator publishes it on-chain) start taking orders —
all gated behind `DATABASE_URL` the same way Faz I/J are.

- **Esnaf Paneli** (`apps/web/app/merchant-dashboard`, distinct from the fulfillment-only
  **Esnaf Konsolu** at `/merchant`): create a merchant (starts `draft`), manage products/
  inventory/pricing settings, view the LLM pricing-decision log. Routes and repo functions
  live in `apps/platform-api/src/merchantRoutes.ts` and `packages/db/src/repos/merchantAdmin.ts`.
- **Publishing + operator admin panel** (`apps/web/app/admin`, gated behind
  `PLATFORM_OPERATOR_ACCOUNT_IDS` — a comma-separated accountId allowlist, surfaced to the
  frontend as `isOperator` on `GET /me`): lists every merchant regardless of owner, with
  suspend/activate actions, plus a disputes queue (review → resolve → close). Publishing
  itself still happens from a merchant's own dashboard page once an operator is signed in —
  it calls `merchant_directory.list_merchant` + `order_escrow.set_merchant_wallet` on real
  Solana devnet, signed with the relayer key (`RELAYER_PRIVATE_KEY`), and stamps the
  returned on-chain `merchantId` back onto the Postgres row. Until published, a merchant has
  no on-chain identity and can't take escrow-backed orders.
- **LLM-assisted pricing**: negotiation-enabled self-service merchants get an LLM-proposed
  discount (`apps/merchant-agents/src/discountProvider.ts`, `AI_PROVIDER=mock|agy`) that is
  always clamped by a deterministic policy (`pricingPolicy.ts`) to the merchant's own
  `maxDiscountBps`/`minPriceMicro` before it ever reaches a quote — the LLM never sets a
  final price. The discount call has a hard timeout (`AGY_TIMEOUT_MS`) and a basic
  per-merchant in-memory rate limit; any failure (timeout, bad output, rate limit) falls back
  to the plain undiscounted quote rather than failing the request, and every decision
  (including fallbacks) is logged to `pricingDecisions` — visible on the panel's "Kararlar"
  page.
- **Disputes** (minimal slice, no staking/slashing): a buyer opens one from the receipt page
  (`POST /shopping/tasks/:taskId/orders/:orderId/dispute`); the merchant can see disputes
  against their own orders read-only (`/merchant-dashboard/:id/disputes`); an operator
  reviews → resolves → closes from `/admin/disputes`, which calls the deployed
  `order_escrow.resolve` instruction through the relayer key.
- **Campaigns**: CRUD (`/merchant-dashboard/:id/campaigns`) plus real pricing effect —
  `apps/merchant-agents/src/campaignPricing.ts` evaluates `percent_off`/`fixed_off` rules
  deterministically at quote time (composed with, and applied before, any negotiation/LLM
  discount), capped by each rule's own `maximumDiscountMicroUsdc` and the same price floor
  everything else respects. The schema also defines `bogo`/`bundle`/`min_basket`/
  `time_window`/`loyalty`/`first_order` rule types — those stay create/edit-able through the
  API but are not yet evaluated against a quote.

## Architecture

```
/apps/web                  Next.js 15 + TS + Tailwind v4 (design tokens)   :3000
/apps/local-agent-bridge   Hono — the personal AI agent + mock/real chain  :3001
/apps/platform-api         Hono — Solana wallet auth, session wallet,
                           merchant self-service + admin routes (live-only) :3002
/apps/merchant-agents      Hono — all 5 seed merchants + self-service ones  :4000
/solana                    Anchor workspace — merchant_directory,
                           order_escrow, order_receipt (litesvm/cargo test
                           + IDL/TS type generation), deployed on devnet
/packages/shared           zod schemas, canonical SKUs, Ed25519 quote
                           signatures, PDA/instruction helpers, USDC
                           helpers, Haversine, merchant seed, chain config,
                           Node-only session middleware (`/sessionAuth` subpath)
/packages/db               live-version only — Drizzle schema, Postgres client,
                           Redis client (see "Live-version infrastructure" above)
/scripts                   seed.ts, demo.ts (boots both services in-process),
                           seed-pg.ts, chain-smoke.ts, ledger-check.ts,
                           init-devnet.ts (deploy + register the 5 seed merchants)
```

Storage is SQLite via Node's built-in `node:sqlite` — one DB file per service
(`apps/*/data/*.db`), idempotency store included, in mock mode. No Postgres, no Redis, no
Solana RPC required for the mock demo.

### The non-negotiables, where they live

| Rule | Enforcement |
| --- | --- |
| Every merchant request is paid | `paymentGate` middleware on all merchant endpoints (`apps/merchant-agents/src/payments.ts`) |
| LLM never produces prices/stock/discounts directly | Plans are zod-validated to canonical SKUs only; all money math is deterministic from the inventory DB. From Faz 3 on, the LLM may *propose* a discount bps, but `pricingPolicy.ts` always clamps it before it reaches a quote — see AGENTS.md |
| USDC-native integer micro-USDC | `packages/shared/src/usdc.ts` — no floats, no fiat anywhere |
| Signed quotes | Merchant Ed25519-signs every quote with its Solana wallet key; verified at quote receipt AND again at order time and before escrow funding (`packages/shared/src/quoteSignature.ts`) |
| Idempotency on every paid request | SQLite `idempotency` table: same key+payload → replay; different payload → 409; proofs are single-use |
| Research budget enforced in code | `MockPaymentProvider.pay()` checks per-request cap (0.002) and total (0.01) **including pending spends** before issuing any proof |
| Escrow releases on pickup code | merchant `verify-pickup` → `keccak256(code)` check → on-chain `confirm_pickup`; manual user release exists only as a labeled fallback; the timeout worker auto-refunds past `releaseDeadline` |
| Mock-first | `MOCK_PAYMENTS` / `MOCK_CHAIN` / `AI_PROVIDER` env toggles; real integrations live behind adapters |

### Payment flow (x402-style)

Unpaid request → HTTP `402` + `{ amountMicroUsdc, asset, network, payTo, endpoint, reason,
idempotencyKey }` → the bridge pays via its `PaymentProvider` and retries with an
`X-Payment` proof header. In mock mode the proof is an HMAC token the merchant verifies
locally; the bridge debits the task's research budget in SQLite. Failed negotiations
auto-refund the 0.002 USDC fee (`x-fee-refunded` header → budget credit).

Endpoint prices: ask 0.0002 · inventory 0.0003 · quote 0.0005 · negotiate 0.002 ·
reserve 0.001 · order 0.001 (all USDC).

### Order state machine

`quoted → user_selected → merchant_pending → merchant_confirmed → awaiting_funding →
paid_in_escrow → preparing → ready → completed`, with exits `expired` (quote/reservation
TTL), `refunded` (cancel / prep-timeout / deadline), `cancelled`, `merchant_rejected`,
`disputed`. Every transition is appended to the order's `stateLog` and pushed over SSE to
the UI. (In pure mock mode with no `DATABASE_URL`, the pre-funding chain from
`merchant_pending` to `awaiting_funding` is fast-forwarded in one step — see AGENTS.md's
"Sipariş Durum Makinesi".)

### Demo spend budget (köfte run)

5 quotes (0.0025) + reserve (0.001) + 2 quality asks (0.0004) + 1 negotiation (0.002) +
4 order fees (0.004) = **0.0099 / 0.01 USDC** — the budget gauge ends one micro-action away
from the cap, and the enforcement test proves overruns are physically blocked.

## Wallet UX note

In real mode, micropayments come from a **session wallet** funded once by the user — so
there are no per-request wallet popups; only the final escrow funding uses the connected
wallet (`@solana/wallet-adapter-react`, Phantom/Solflare on Solana devnet). In mock mode
this is the simulated wallet widget in the header, seeded with 25 USDC.

## AGY (Antigravity) configuration

The planner is behind `llmProvider.ts`:

```bash
AI_PROVIDER=agy
AGY_BASE_URL=http://localhost:8080/v1   # OpenAI-compatible /chat/completions
AGY_API_KEY=...                          # optional
AGY_MODEL=agy-default
```

The system prompt pins the model to the canonical SKU list and pure-JSON output; responses
are zod-validated and non-canonical SKUs are dropped. `AI_PROVIDER=mock` (default) returns
deterministic plans for the demo prompts, so the demo never depends on a live model. The
same `AI_PROVIDER`/`AGY_*` env also drives Faz 3's merchant-side discount provider (see
above) — one adapter pattern reused for both directions.

## Solana programs (Anchor, devnet)

```bash
cd solana
anchor build                          # compiles the 3 programs, emits IDL + TS types
anchor test                           # cargo test → litesvm-based integration tests
```

```bash
pnpm solana:build                     # same, from repo root
pnpm solana:deploy:devnet             # anchor deploy --provider.cluster devnet
pnpm solana:init:devnet               # scripts/init-devnet.ts — initializes program state
                                       # and registers the 5 seed merchants on-chain
pnpm chain:smoke                      # scripts/chain-smoke.ts — real devnet fund/release/refund proof
```

- **order_escrow** — `fund` (SPL Token CPI transfer, buyer-authorized), `mark_preparing`/
  `mark_ready` (merchant wallet only), `confirm_pickup(order_id, code)`
  (`keccak256(code) == pickup_code_hash` → release), `refund` (buyer-cancel pre-Preparing, or
  anyone past deadline), `user_release` (buyer fallback), `resolve` (arbiter = relayer
  authority, MVP dispute resolution). PDAs replace EVM's mapping/storage-slot model.
- **merchant_directory** — thin on-chain merchant registry (`list_merchant`,
  `set_merchant_wallet`), authority-gated to the relayer key.
- **order_receipt** — per-task receipts written by the relayer, mirroring the escrow's
  lifecycle events.

Program IDs are not env-configurable — they're fixed at build time in `declare_id!`/the IDL
and imported from `packages/shared/src/solana/programIds.ts`, unlike an EVM contract
address read from an env var.

## Real mode (env-gated, best effort)

Mock mode remains the reliable demo path. The swap points:

1. **Payments** — `apps/local-agent-bridge/src/paymentClient.ts`'s real `PaymentProvider`
   verifies/sends SPL Token transfers; the merchant-side verification hook is in
   `apps/merchant-agents/src/payments.ts`.
2. **Chain** — `createChainProvider` in `apps/local-agent-bridge/src/chain.ts` degrades to
   mock with a console warning unless `SOLANA_RPC_URL`, `RELAYER_PRIVATE_KEY`, and
   `USDC_MINT` are set. Real calls go through `packages/shared/src/solana`'s typed
   instruction builders, not a hand-written ABI.
3. **Identity/reputation** — there is no Solana equivalent of ERC-8004 deployed yet;
   `identityCheck`/`postFeedback` work off seed data/logs and don't write on-chain (see
   `chain.ts`).
4. **Merchant signer keys** — override the deterministic dev seeds
   (`packages/shared/src/solanaKeys.ts`) via `MERCHANT_<SLUG>_PRIVATE_KEY` env vars before
   seeding; self-service merchants get their own AES-256-GCM-encrypted signer key generated
   at creation time instead.

## Deliverables map

- Tests: `packages/shared/test`, `packages/db/test`, `apps/merchant-agents/test`,
  `apps/local-agent-bridge/test`, `apps/platform-api/test` (vitest); `/solana/programs/*/tests`
  (`cargo test`/litesvm).
- Project guide for coding agents: [AGENTS.md](AGENTS.md) — the source of truth for
  architecture, non-negotiables, and env vars; kept current across every phase.
- Historical decisions/plans (EVM/Arc-testnet era, superseded by the Solana architecture
  above — kept for record, not current): [DECISIONS.md](DECISIONS.md), [LIVE_PLAN.md](LIVE_PLAN.md),
  [LIVE_PLAN_V2.md](LIVE_PLAN_V2.md).
- Env template: [.env.example](.env.example).
