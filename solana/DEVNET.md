# Deploying to Solana devnet

**Status: deployed and verified.** All 3 programs are live on devnet, initialized,
with the 5 seed merchants registered, and `scripts/chain-smoke.ts`'s 3 scenarios
(happy path, wrong pickup code, past-deadline refund) all passed against real
transactions. This doc remains as the runbook for redeploying from scratch
(new keypairs, a fresh cluster, or a clean environment).

> This must be run from an environment with real outbound network access to
> `api.devnet.solana.com` (or your own RPC provider). It cannot run inside a
> network-isolated sandbox — DNS may resolve but the RPC calls will hang/time
> out with no network egress.

> **Use a dedicated RPC endpoint (Helius/QuickNode/Triton free tier), not the
> public `api.devnet.solana.com`, for anything beyond a single deploy.** The
> public endpoint's per-method rate limit gets exhausted fast once you're
> running `init-devnet.ts` (dozens of transactions) and `chain-smoke.ts`
> repeatedly — it can take a long, unpredictable window to recover, whereas a
> free Helius devnet key (`https://devnet.helius-rpc.com/?api-key=...`,
> 2-minute no-card signup) has a much higher quota. Set it as `SOLANA_RPC_URL`
> only (server-side) — never as `NEXT_PUBLIC_SOLANA_RPC_URL`, which gets
> bundled into the public browser JS and would leak the key.

## 0. Prerequisites

- `solana-cli` and `anchor-cli` installed (this repo was built against
  `solana-cli 3.1.10` / `anchor-cli 1.1.2`, the OtterSec Anchor fork —
  `anchor-lang`/`anchor-spl` 1.1.2, not the classic coral-xyz 0.3x line).
- A local deploy wallet at `~/.config/solana/id.json` (or wherever
  `solana/Anchor.toml`'s `[provider].wallet` points). This wallet becomes the
  `authority` for all 3 programs' config PDAs.
- `pnpm i` run at the repo root (installs `@solana-program/system`,
  `@solana-program/token`, `@solana/kit` needed by `scripts/init-devnet.ts`).

## 1. Fund the deploy wallet

```bash
solana config set --url devnet
solana airdrop 2   # devnet faucet is rate-limited; repeat if needed, or use
                    # https://faucet.solana.com
solana balance
```

Deploying all 3 programs costs a few SOL in rent (devnet SOL has no real
value). Airdrop more if `anchor deploy` fails with insufficient funds.

## 2. Deploy the programs

The program keypairs already exist under `solana/target/deploy/` from the
offline build, and their public keys are already baked into
`declare_id!(...)` in each program's `lib.rs`, into `solana/Anchor.toml`'s
`[programs.devnet]` section, and into
`packages/shared/src/solana/programIds.ts`. As long as you deploy using
those same keypairs, none of that needs to change.

```bash
pnpm run solana:build           # rebuild if target/ was cleaned; keypairs
                                 # under target/deploy/ persist across builds
                                 # as long as the *-keypair.json files aren't deleted
pnpm run solana:deploy:devnet   # anchor deploy --provider.cluster devnet
```

Verify each program landed:

```bash
solana program show wRjcJxHLmDiStxUv5hhg4m3EZKnywZcBQj1W27unSHZ --url devnet
solana program show 3M8mUguDLdnvPqvVE9KYp11MfkTcGYCo8UhnVqoCCCuV --url devnet
solana program show B5htcm88nzRtNyfHMyhh7SQ5pHudw1dMx6Ean5xP2wsm --url devnet
```

If you ever redeploy under **new** program keypairs (e.g. the old ones were
lost), update all three places above together — `declare_id!`, `Anchor.toml`,
and `programIds.ts` — or client calls will target a program ID with nothing
deployed there.

> **Known issue on Windows-hosted WSL:** `anchor deploy`'s post-deploy "push
> the IDL on-chain" step can fail with a UNC-path/CMD.EXE error when `anchor`
> is invoked through a `wsl.exe`-from-Windows bridge (some subprocess it
> spawns loses the WSL working directory). The program binary upload itself
> still succeeds before that point — check with `solana program show <id>
> --url devnet` before assuming the whole deploy failed. If it happens, deploy
> the remaining programs directly with the low-level command instead, which
> never touches IDL and works fine:
> ```bash
> solana program deploy target/deploy/order_escrow.so \
>   --program-id target/deploy/order_escrow-keypair.json --url devnet
> ```
> No on-chain IDL account is required for anything in this repo — the apps
> read the IDL straight from the JSON file in `packages/shared/src/solana/idl/`.

## 3. Set up `.env`

Copy `.env.example` → `.env` at the repo root if you haven't, then set:

```
MOCK_CHAIN=false
MOCK_PAYMENTS=false
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
RELAYER_PRIVATE_KEY=<hex-encoded 32-byte Ed25519 seed — NOT a dev key from
                      packages/shared/src/solanaKeys.ts, generate a fresh one>
MERCHANT_ALI_KASAP_PRIVATE_KEY=<same, one per merchant>
MERCHANT_CAN_KASAP_PRIVATE_KEY=
MERCHANT_ZEYNEP_MANAV_PRIVATE_KEY=
MERCHANT_CEM_FIRIN_PRIVATE_KEY=
MERCHANT_MINI_MARKET_PRIVATE_KEY=
```

Leave `USDC_MINT` empty for now — the init script below creates a fresh
devnet-only test-USDC mint if it's unset and prints the address to paste
back in. (There is no reliably-maintained official devnet USDC faucet mint
at the time of writing; a self-minted test token is the pragmatic choice for
a devnet pilot. Swap in a real mint address later if one becomes available.)

Generate a fresh seed for each key above, e.g.:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4. Initialize the on-chain config + register the 5 seed merchants

```bash
pnpm run solana:init:devnet     # tsx scripts/init-devnet.ts
```

This is idempotent — safe to re-run. It will:

1. Airdrop devnet SOL to the relayer and each of the 5 merchant wallets
   (best-effort; devnet faucets are rate-limited, fund manually if it warns).
2. Create a test-USDC SPL mint if `USDC_MINT` isn't set, and mint some to the
   relayer's associated token account (the relayer plays "buyer" in
   `scripts/chain-smoke.ts`).
3. Call `initialize` on all 3 programs' config PDAs.
4. Call `list_merchant` (merchant_directory) + `set_merchant_wallet`
   (order_escrow) for each of the 5 `SEED_MERCHANTS`.

Copy the `USDC_MINT=...` value it prints into `.env` so subsequent runs
reuse the same mint instead of creating a new one each time.

## 5. Verify end-to-end

```bash
pnpm run chain:smoke   # tsx scripts/chain-smoke.ts
```

Runs the 3-scenario real-chain smoke test (happy path, wrong pickup code,
past-deadline refund) against the now-live devnet programs. See
`scripts/chain-smoke.ts` for what each scenario checks.

Once this passes, `pnpm dev` with `MOCK_CHAIN=false` / `MOCK_PAYMENTS=false`
in `.env` runs the full app stack against real devnet transactions.

## Notes

- `merchant_directory` is deployed and initialized by this runbook, but no
  app currently *reads* from it at runtime (`identityCheck`/`postFeedback`
  in `chain.ts` still use `SEED_MERCHANTS`' seeded flags) — see AGENTS.md's
  "Gerçek Mod Geçiş Noktaları" #6. It's kept live and registered for
  completeness/future wiring, not because something depends on it today.
- `attestation_uid` is written as 32 zero bytes by `init-devnet.ts` — there is
  no attestation authority deployed, so this is a documented placeholder, not
  a real attestation.
