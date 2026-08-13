# MerchantMesh MVP submission

## What to share

- Repository root: source code, README, `.env.example`, tests, and Solana programs.
- Pitch deck: [`MerchantMesh-MVP-Deck.pptx`](./MerchantMesh-MVP-Deck.pptx).
- Network: Solana Devnet.
- Demo flow: connect wallet → describe basket → approve list → compare signed quotes → select merchants → fund escrows → confirm pickup and release.

## Before pushing to GitHub

Never commit `.env`, `.env.local`, database files, run logs, private keys, session-wallet material, or `solana/target` build outputs. The repository `.gitignore` excludes these files.

Run the release checks:

```bash
pnpm install
pnpm test
pnpm typecheck
```

For the deterministic localhost demo:

```bash
pnpm db:seed
pnpm dev
```

Open `http://localhost:3000`.

## GitHub commands

The repository has been initialized locally. Review every staged file, then create the first commit:

```bash
git add .
git status
git commit -m "Prepare MerchantMesh Solana Devnet MVP"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/merchantmesh.git
git push -u origin main
```

Do not run `git add .` without checking `git status` before the commit.

## Important hosting distinction

GitHub stores and presents the project, but it does not run the complete MVP. MerchantMesh needs four Node services plus Postgres and Redis in live mode. GitHub Pages can host static files only; it cannot run the bridge, merchant agents, platform API, or database.

For a judged submission, publish the repository and deck first. If a public interactive demo is mandatory, deploy the web app and the three APIs to a Node-capable host, provision Postgres/Redis, configure the environment secrets, and run the Devnet smoke test before sharing the URL.
