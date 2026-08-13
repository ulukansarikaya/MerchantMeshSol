# DECISIONS.md — where the spec was silent, the simplest reasonable choice

> **ARŞİV NOTU:** Bu log, projenin EVM/Foundry/Base Sepolia/Arc-testnet döneminde (Faz 0
> civarı) alınan kararları kayıt altına alır. O tarihte doğruydu ve tarihsel kayıt olarak
> değiştirilmedi. Zincir katmanı daha sonra tamamen **Solana**'ya taşındı — güncel mimari
> için [AGENTS.md](AGENTS.md) ve [README.md](README.md)'ye bakın; burada geçen viem/wagmi/
> EIP-712/Foundry/Base Sepolia/Arc referansları artık koddaki karşılıklarıyla eşleşmiyor.

1. **SQLite driver: Node built-in `node:sqlite`** instead of better-sqlite3/Drizzle.
   This machine has no native build toolchain; `node:sqlite` (Node ≥ 23.4) is dependency-free,
   synchronous, and API-equivalent for this use. Each service wraps it in a thin `db.ts`, so
   swapping to better-sqlite3 is a one-file change per service.

2. **Foundry is not installed on the build machine.** The three contracts, the full forge
   test suite (happy path, wrong pickup code, prep-timeout refund, double-fund, reentrancy,
   both dispute verdicts, access control) and the deploy script are written and delivered,
   but `forge test` could not be executed locally. Mock mode — the reliable demo path per the
   spec — does not depend on them. Run `forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts && forge test` on a machine with Foundry.

3. **The mock chain lives in the bridge** (`/chain/*` endpoints on :3001). Escrow state must
   be consistent between funding (bridge) and release (merchant), so the simulated chain is a
   single authority; merchants "submit txs" to it over HTTP exactly as they would to Base
   Sepolia. The bridge also plays the relayer (RELAYER_ROLE), matching OrderReceipt.

4. **Mock payment proofs are HMAC tokens** with a shared secret (`MOCK_PAYMENT_SECRET`), so
   merchants verify locally with no round-trip — mirroring x402 facilitator verification.
   Proofs are single-use, bound to `{amount, payTo, endpoint, idempotencyKey}`, and expire
   after 10 minutes.

5. **Partial quotes + subset orders.** A quote request may include items the shop doesn't
   stock (markets get the whole list); the merchant quotes what it carries and reports
   `omittedSkus` + `stockHints`. An order may buy a **subset** of a signed quote; unit prices
   always come from the signed quote (never the request) and the subset is validated against
   it. This keeps the demo within one quote per merchant (budget!) while staying
   tamper-proof.

6. **Micro-action rules (deterministic):**
   - *Quality-score*: only when ≥2 **same-category specialists** quote the item (butcher vs
     butcher) and the price spread exceeds the oracle cost (2 × ask fee). Cross-category
     spreads (fresh bakery bread vs packaged market bread) are not a quality signal.
   - *Negotiation*: only with **sole suppliers** (shops that appear in every option) that
     have negotiation enabled and an expected discount (5% of quote total) above the 0.002
     fee — and only if the remaining budget still covers the planned order fees
     (max option stops × 0.001). This is why the demo negotiates with Zeynep and not the
     butchers (user still chooses between them) and lands at 0.0099/0.01 USDC.
   - *Reservation*: when the merchant supports it and our need nearly drains stock
     (`stock − need ≤ 1`) — Cem Fırın's last 2 loaves.
   - *Counter-offer*: merchant concedes half the requested discount, capped at
     `maxDiscountBps`, floored at per-item `minPriceMicroUsdc` (invariant: never below min).

7. **Receipt counts both items and shops.** The spec's demo line says "completedItems: 2/3
   shops"; with the specified 6-item köfte list the Best Quality option spans 4 shops
   (butcher, greengrocer, bakery, market). The receipt therefore reports
   `completedItems/totalItems` (5/6 when ayran is dropped) **and** `completedShops/totalShops`
   (3/4) plus the dropped-shop note — same intent, honest numbers.

8. **Mini Market also sells packaged bread** (0.55 vs Cem's fresh 0.40). Without it no route
   differences exist and the pickup-optimized option could never differ; with it the greedy
   set-cover produces a genuine 3-stop route.

9. **Pickup-code UX:** the bridge generates a 6-digit code per shop at order time and stores
   only `keccak256(code)` on-chain; codes are shown to the buyer on the flow page/receipt.
   `verify-pickup` accepts an order in `preparing` too (customer arrived early) by marking
   ready on the way through — the contract mirrors this.

10. **Frontend is mock-wallet-first.** The simulated session-wallet widget (balance +
    research-budget gauge) replaces wagmi wallet-connect in mock mode; wagmi/viem connect is
    part of the env-gated real mode (M7 best effort) and its mount point is the
    `WalletWidget`. The web app duplicates the 15-line micro-USDC formatter instead of
    bundling the shared package to keep the Next build decoupled from Node-only modules.

11. **Failed-then-dropped shops:** when escrow funding fails, the already-placed merchant
    order is cancelled via an internal endpoint and its stock restored. Saga order is
    alternative merchant → drop non-essential shop → cancel + refund everything (essential).

12. **Timeout worker cadence:** single `setInterval` (2s) in the merchant service — expires
    quotes, releases reservations back to stock, and drives prep-timeout escrow refunds
    through the chain provider, notifying the bridge (SSE) on each refund.

13. **`vitest@3`** is required (vite 6 recognizes `node:sqlite` as a builtin; vite 5 tries to
    bundle it and fails).

14. **Research-budget wallet accounting:** micropayments debit the per-task research-budget
    ledger; the mock session wallet balance tracks main payments (escrow fund/refund) only.
    In real mode both would flow through the session wallet — that accounting belongs to the
    X402Provider swap point.

## Live-version (V2) — Faz 0

15. **x402 v2 placeholder values in mock mode:** until Faz B wires real `CHAIN_ID`/
    `CHAIN_NAME`/`USDC_ADDRESS`, the merchant's 402 payload uses `chainId=84532` (also the
    EIP-712 domain default), `network="mock"`, `asset="USDC"` (symbol, not an address), and
    `scheme="mock-hmac"` when `MOCK_PAYMENTS=true` (`"erc20-transfer"` otherwise). These are
    read from env with those fallbacks (`apps/merchant-agents/src/index.ts`), so Faz B only
    needs to set the env vars — no code changes.
16. **chainId threading is mandatory, not defaulted, in the eip712 API surface**
    (`signQuote`/`verifyQuoteSignature`/`hashQuote`/`quoteTypedData` all take `chainId` as a
    required parameter). This was deliberate: an optional default risks a silent mismatch
    between bridge and merchant-agents chainId config that would only surface as a confusing
    "quote_signature_invalid" at order time. Both services read the same `CHAIN_ID` env var.
17. **Mock/test flow fast-forwards the pre-funding chain.** `merchant-agents`'
    `createOrder()` now inserts orders directly at `awaiting_funding` with the full
    `quoted → user_selected → merchant_pending → merchant_confirmed → awaiting_funding`
    path recorded in `state_log_json` (all same-timestamp). This keeps the existing mock
    demo/tests working without a real merchant-accept UI, which is explicitly Faz I's job —
    Faz I replaces this with a live `merchant_pending` window and real accept/reject uçları.
18. **`/internal/cancel-order`'s cancellable state moved from `approved` to
    `awaiting_funding`** — same semantics (escrow funding reverted → restore stock → mark
    cancelled), just renamed to match the v2 state that now precedes `paid_in_escrow`.
19. **`BASE_SEPOLIA_RPC_URL` renamed to `CHAIN_RPC_URL`** in the real-chain env checklist
    (`apps/local-agent-bridge/src/chain.ts`) per Faz 0 §3's EVM-generic naming rule. The
    `BaseSepoliaProvider`/`EvmChainProvider` implementation itself is still Faz B's job; this
    phase only aligned the env var name and `.env.example`.

## Live-version (V2) — Faz A

20. **No Docker on the build machine; used WSL2 + native Postgres instead.** The spec's
    documented default is `docker-compose.dev.yml` (written, works for anyone with Docker),
    but this machine has neither Docker nor a Windows-native Postgres with PostGIS/pgvector
    (the EDB installer ships neither extension, and Windows pgvector builds lag PG18). Set up
    a second PostgreSQL 16→18 inside WSL2 Ubuntu on port 5433 with `postgis` +
    `postgresql-<ver>-pgvector` from apt, verified against a live connection. WSL2 forwards
    `localhost` to Windows automatically, so `DATABASE_URL` needed no other change. Documented
    as the README fallback path; Docker remains the primary documented route for anyone else.
21. **`drizzle-kit generate` requires a `tsx/cjs` register hook in this setup.** Schema files
    use `.js`-suffixed relative imports (repo convention, matches `moduleResolution: Bundler`
    at runtime), but drizzle-kit 0.28's own CJS loader can't resolve `./core.js` back to
    `./core.ts` and fails with `MODULE_NOT_FOUND`. Fix: `node -r tsx/cjs
    node_modules/drizzle-kit/bin.cjs generate` (wired into `packages/db`'s `generate` script)
    — `tsx/cjs`'s require hook resolves the extension correctly. `drizzle-kit migrate`/`push`
    were not needed (we apply migrations via `drizzle-orm`'s own `migrate()` in
    `src/migrate.ts`, which only reads generated `.sql` files — no schema import, no issue).
22. **`customType` columns with a parametric SQL type name must be scrubbed by hand** — the
    generated migration wrapped `geography(Point,4326)` in double quotes
    (`"geography(Point,4326)"`), which Postgres parses as a quoted identifier, not a type
    expression, and fails with `type "geography(Point,4326)" does not exist`. `vector(1536)`
    was unaffected (drizzle-orm/drizzle-kit have first-party pgvector support and emit it
    unquoted). Fixed by stripping the quotes in the generated `.sql` file post-generation;
    documented here so the next schema change involving `geographyPoint` repeats the fix
    rather than re-debugging it. A native `bigint` default of `0n` also broke migration
    generation (`JSON.stringify` can't serialize `BigInt` in drizzle-kit's snapshot diff) —
    use `.default(sql\`0\`)` instead of `.default(0n)` for any bigint column default.
23. **PostGIS geography columns are not round-tripped through the ORM.** `geographyPoint`
    (`packages/db/src/types.ts`) exposes only a raw EWKT string for `INSERT`/`UPDATE`
    (`'SRID=4326;POINT(lng lat)'`, which PostGIS's `geography_in` parses natively — no
    `ST_GeogFromText()` wrapping needed on write). Reads always go through explicit
    `ST_Distance`/`ST_DWithin`/`ST_X`/`ST_Y` in raw SQL (see the Faz A smoke test), never a
    typed `SELECT` on the column, because geography's default wire format is EWKB hex, not
    WKT — parsing that generically in `fromDriver` isn't worth it before Faz H actually needs
    real query functions.
24. **`session_wallets` and `payment_proofs` tables live in Faz A**, even though
    `LIVE_PLAN_V2.md §17`'s table list doesn't spell out `session_wallets` by name — Faz 0 §4
    and Faz J's spec both assume these tables already exist by the time they're needed, so
    defining them now (unused until Faz C/J wire real logic) avoids a schema migration split
    across fazes for a single feature.
25. **Root-level scripts import workspace packages by relative path, not package name**
    (`scripts/seed-pg.ts` imports `../packages/db/src/index.js`, matching `scripts/demo.ts`'s
    existing convention) — the repo root's `package.json` isn't a dependent of
    `@merchantmesh/db`/`@merchantmesh/shared`, so pnpm's isolated `node_modules` can't resolve
    the package-name import from a script that lives outside any workspace package. Third-party
    packages a root script needs directly (e.g. `drizzle-orm`'s `eq()`) do need adding to the
    root `package.json` as a devDependency, since there's no workspace symlink for those.
26. **Surrogate keys are `uuid().defaultRandom()`** for every new Postgres table, except
    `wallets.address` (the address itself is the natural key) — a clean, DB-native choice
    since these tables have no existing app-level ID convention to match (unlike the mock
    SQLite tables' prefixed strings like `o_<uuid>`, which `task_orders.id` deliberately keeps
    for continuity with the bridge's current order-id format).

## Live-version (V2) — Faz B

25. **`ChainProvider.walletBalanceMicroUsdc()` ve `getEscrow()` artık `Promise` döndürüyor**
    (öncesinde senkron SQLite okumasıydı, mock modda hâlâ öyle — ama gerçek RPC okuması async
    olmak zorunda). Bu, arayüzü kullanan her yeri (server.ts `/wallet` + `/chain/escrow/:id`,
    orchestrator.ts `taskSnapshot()` ve `funding_complete` event'i, seed-cli.ts,
    bridge.test.ts'in 8 `taskSnapshot` çağrısı, scripts/demo.ts'in 7 çağrısı) `await`
    kullanacak şekilde güncellemeyi gerektirdi — mekanik ama geniş kapsamlı bir değişiklikti.
26. **`ChainProvider.mode`'un tipi `"mock" | "base-sepolia"` → `"mock" | "evm"` oldu**,
    Faz 0'ın "zincir adı koda gömülmez" kuralıyla tutarlı olsun diye (gerçek ağ adı artık
    `CHAIN_NAME` env'inden, sabit "base-sepolia" değil).
28. **`MerchantChainClient`'ın metodları artık `signerKey: Hex` parametresi alıyor**
    (`markPreparing/markReady/confirmPickup`). Tek bir `merchant-agents` süreci 5 esnafa
    hizmet ediyor ve OrderEscrow'un `onlyMerchant` modifier'ı HER işlemin doğru esnafın
    kendi anahtarıyla imzalanmasını zorunlu kılıyor — tek bir merkezi `chain` client
    instance'ı (mock moddaki gibi) bunu karşılayamaz. `MockChainClient` bu parametreyi
    yok sayar (TS'te daha az parametre almak fazladan argümanı sessizce görmezden gelir,
    arayüzü hâlâ tatmin eder); `EvmMerchantChainClient` her çağrıda o esnafın anahtarıyla
    taze bir `walletClient` kurar (hafif maliyet, basitlik için tercih edildi).
29. **Bridge'in `markPreparing/markReady/confirmPickup` metodları gerçek modda ÇAĞRILMAZ,
    hata fırlatır.** Kontratın `onlyMerchant` koruması relayer'ın bu işlemleri imzalamasını
    zaten engelliyor; gerçek modda merchant-agents kendi `EvmMerchantChainClient`'ını
    kullanıp doğrudan zincire yazıyor, bridge'in `/chain/*` endpoint'lerine hiç uğramıyor
    (`MOCK_CHAIN=false` iken merchant `EvmMerchantChainClient` seçiyor, `MockChainClient`
    değil). Sessizce hiçbir şey yapmak yerine açıkça hata fırlatmak, bir kablolama
    hatasını (biri merchant'ı mock, bridge'i gerçek modda bırakırsa) gürültülü şekilde
    ortaya çıkarır.
30. **ABI'ler `forge build` çıktısından otomatik çıkarılıp `packages/shared/src/abis/`
    altına TS `as const` export'u olarak yazıldı** (elle yazılmadı — insan hatasına açık).
    Kontrat değişirse aynı çıkarma adımı (plans/faz-b.md'de belgelenen node script'i)
    tekrar çalıştırılmalı.
31. **Arc'ın USDC'si için ERC-20 arayüz adresi (`0x3600…0000`, 6 decimal) kullanılıyor,
    native 18-decimal formu değil** — bu, kod tabanındaki mikro-USDC (6 decimal) kuralıyla
    hiçbir dönüşüm kodu gerektirmeden birebir örtüşüyor. Detay: `contracts/deployments/arc-testnet.md`.
32. **Faucet günlük 1 USDC/adres limiti nedeniyle smoke test minimal cüzdan setiyle
    tasarlandı**: relayer HEM deployer HEM test-alıcısı rolünde (aynı anahtar), yalnızca
    Ali Kasap esnaf tarafı için ayrıca fonlanıyor. Diğer 4 esnaf cüzdanı deploy'da
    kaydediliyor ama bu fazın smoke test'inde kullanılmıyor — sonraki fazlarda fonlanacak.
33. **`fund()` Faz B'de relayer'ın kendi anahtarıyla imzalanıyor, gerçek bir alıcı
    cüzdanıyla değil.** OrderEscrow'un `fund()`'ı `msg.sender`'ı buyer olarak kaydediyor —
    yani kim imzalarsa alıcı o oluyor. Bu fazda `EvmChainProvider.fund()` hâlâ sunucu
    tarafında relayer'ın anahtarıyla imzalanıp gönderiliyor; bu, Faz I'in "kullanıcı
    cüzdanından fonlama" değişikliğinden önceki kasıtlı bir ara adım. Gerçek zincirde
    escrow akışının uçtan uca (fund→prepare→ready→release) çalıştığını `chain-smoke.ts`
    ile kanıtlamak için yeterli ve doğru bir kapsam sınırı — Faz I geldiğinde `fund()`'ın
    rolü "imzala ve gönder"den "frontend'in gönderdiği tx hash'i doğrula"ya dönüşecek
    (spec'in kendi notu, plans/faz-b.md §3).

## Live-version (V2) — Faz C

34. **`tasks.id` `uuid().defaultRandom()` yerine `text()` oldu.** Bridge'in mevcut görev
    ID formatı (`t_<uuid>`, SQLite'ta `TEXT PRIMARY KEY`) Postgres tarafında da birebir
    saklanabilsin diye — bridge zaten kendi ID'sini üretiyor, Postgres'in `defaultRandom()`
    üretmesine gerek yok, ve iki farklı ID formatı (SQLite `t_<uuid>` vs Postgres ham uuid)
    aynı görevi temsil edemezdi. Beş FK sütunu (`quotesSeen.taskId` vb.) da aynı sebeple
    `uuid` → `text` değişti; bu, mevcut migration'ı sıfırlayıp yeniden üretmeyi gerektirdi
    (dev ortamında kabul edilebilir, henüz canlıda veri yoktu).
35. **`seedDb(db, allowEnvOverride = true)` — testler her zaman `false` geçmeli.**
    Faz B'nin gerçek Arc anahtarları `.env`'e girdikten sonra, `.env`'i shell'e `source`
    edip testleri çalıştırmak merchant-agents'ın 15 testini kırdı: fixture'lar sabit dev
    cüzdan adresleri varsayıyor, ama `seedDb` artık cüzdanı imzalayan anahtardan türetiyor
    (bkz. #36), ve gerçek env anahtarı varsa türetilen adres fixture'daki sabit adresle
    uyuşmuyordu. Çözüm: gerçek dev-server/seed-cli/script çağrıları env override'ı
    okumaya devam etsin (varsayılan `true`), ama TÜM test harness'leri (`merchant-agents`,
    `local-agent-bridge`) `seedDb(db, false)` ile deterministik dev anahtarlarını
    zorlasın — test determinizmi geliştiricinin shell'indeki ortam değişkenlerinden
    bağımsız olmalı.
36. **Esnaf cüzdan adresi HER ZAMAN imzalayan anahtardan türetilir**
    (`privateKeyToAccount(signerKey).address`), seed'in statik `wallet` alanından değil.
    Bunun tersi sessizce kırılan bir hataya yol açtı: `.env`'de gerçek
    `MERCHANT_ALI_KASAP_PRIVATE_KEY` varken `seedDb` hâlâ sabit dev adresini `wallet`
    sütununa yazıyordu — imzalayan anahtar ile kayıtlı cüzdan adresi uyuşmuyordu, bu da
    her EIP-712 teklif imzasının sessizce doğrulanamamasına (`verified=false`) ve
    orchestrator'ın `gatherQuotes()`'ta HER esnafı atlamasına yol açtı ("No merchant
    could quote any item on the list" hatası — teşhisi zor, çünkü hata mesajı kök nedeni
    işaret etmiyordu).
37. **Bridge'in Postgres/oturum desteği tamamen opsiyonel, dependency-injected bir
    `postgres?: PostgresBridgeSupport` nesnesi üzerinden eklendi**, `server.ts`'e
    doğrudan `@merchantmesh/db` import etmek yerine. `DATABASE_URL` env'de yoksa bu
    nesne `undefined` kalır ve bridge önceki (Faz A öncesi) SQLite-only, oturumsuz
    davranışını bayt bayt korur — mevcut 37 mock testin hiçbiri bozulmadı. `DATABASE_URL`
    varsa `apps/local-agent-bridge/src/index.ts` bu nesneyi doldurup geçiriyor.
    Bu tasarım, "gerçek auth ekle" ile "mock testleri kırma" arasındaki gerilimi çözdü.
38. **Sahiplik kontrolü task bulunamadığında değil, başka hesaba aitse de 404 döner
    (403 değil)** — "varlığı ifşa etme" prensibi: B hesabı, A hesabının görev ID'sini
    tahmin etse bile, görevin var olup olmadığını (403 vs 404 farkından) anlayamaz.
    `assertOwnedOrPublic()` (`server.ts`) Postgres'te izlenmeyen (legacy/mock) görevler
    için hiç kontrol yapmaz — sahiplik yalnızca `postgres` bağlıyken ve görev gerçekten
    Postgres'e yazılmışken zorlanır.
39. **Nonce, imza kontrolünden ÖNCE tüketilir, sonucu ne olursa olsun.**
    `consumeAuthNonce()` `/auth/verify`'de `verifySiweMessage()`'dan önce çağrılıyor —
    imza geçersiz çıksa bile nonce bir daha kullanılamaz. Bu, replay penceresini
    "imza kontrolü başarısız oldu, aynı nonce'u tekrar dene" yoluyla açık bırakmamak
    için kasıtlı bir sıralama (plans/faz-c.md'nin güvenlik checklist'i).
    İlk denemede CORS'u `cors({ origin: (origin) => origin, credentials: true })` olarak
    yazıp (herhangi bir origin'i credentials'lı yansıtan, güvensiz bir joker desen)
    hemen fark edip `cors({ origin: webOrigin, credentials: true })`'a düzelttim —
    session cookie'leri credentials'lı iken sabit, joker olmayan bir origin şart.
40. **`packages/shared/src/sessionAuth.ts` Node-only bir subpath export
    (`@merchantmesh/shared/sessionAuth`).** Ana `@merchantmesh/shared` barrel'ı tarayıcıda
    da import edilebiliyor (web app zod şemalarını kullanıyor); Hono'ya bağımlı oturum
    middleware'ini oraya koymak Hono'yu web'in bundle'ına sızdırırdı. Alt paket export'u
    (`package.json`'daki `exports["./sessionAuth"]`) bunu, ana barrel'ı değiştirmeden
    hem bridge hem platform-api'nin aynı DI middleware'ini paylaşmasına izin vererek çözdü.
41. **Oturum çerezi (`mm_session`) explicit `Domain` olmadan set ediliyor**, yani
    yalnızca host-only (ör. `localhost`) — port'a göre değil hostname'e göre paylaşılıyor.
    Bu bilinçli: platform-api (`:3002`) çerezi koyuyor, bridge (`:3001`) aynı çerezi
    okuyor — tarayıcı çerezleri port'u ayırt etmediği için (yalnızca host+path) bu ekstra
    bir CORS/proxy katmanı gerektirmeden localhost geliştirmede çalışıyor. Prod'da her iki
    servis de aynı üst domain altında olmalı ki bu varsayım geçerli kalsın.
42. **Web tarafında `wagmi/connectors` barrel'ından değil, `wagmi`'nin kendi ana
    export'undan `injected` connector'ı import edildi.** `wagmi/connectors` TÜM
    connector'ları (Coinbase `baseAccount` dahil) statik olarak resolve etmeye çalışıyor;
    `baseAccount` zincirleme olarak `@coinbase/cdp-sdk`'ya, o da opsiyonel/kurulu olmayan
    `@x402/*` paketlerine dynamic-import ile bağlanıyor — webpack bunları build zamanında
    resolve edemeyip "Module not found" hatasıyla tüm web app'in derlenmesini
    engelliyordu. `wagmi`'nin ana barrel'ı sadece `@wagmi/core`'dan hafif bir `injected`
    re-export ediyor, bu sorunu tamamen atlıyor.
43. **`apps/web`'de gerçek mod ile mock mod arasındaki anahtar `NEXT_PUBLIC_MOCK`.**
    `true` iken (varsayılan, `.env.example`) eski simüle cüzdan widget'ı ve kilitsiz
    alışveriş akışı çalışır — Postgres/Redis/zincir kurulu olmayan bir geliştiricinin
    mevcut demo'yu hiçbir değişiklik yapmadan çalıştırabilmesi için. `false` iken wagmi
    ile gerçek cüzdan bağlama + SIWE imzalama akışı devrede olur ve alışveriş akışı
    "cüzdanını bağla" kartının arkasında kilitli kalır. Next.js yalnızca
    `NEXT_PUBLIC_*` önekli değişkenleri tarayıcı bundle'ına gömdüğü için, kök `.env`'deki
    `CHAIN_*`/`DATABASE_URL` gibi değişkenler web'e görünmez — `apps/web/lib/wagmiConfig.ts`
    kendi `NEXT_PUBLIC_CHAIN_*` aynasını okuyor, `readChainEnvConfig()`'i DEĞİL.

## Live-version (V2) — Faz I

44. **Faz A/C'nin Postgres'i o zamana kadar sadece bir "gölge" kopyaydı — Faz I bunu
    keşfetti ve düzeltti.** Faz I'yi uygulamaya başlarken fark edildi: Faz A/C sadece
    hesap/oturum/görev metadata'sını Postgres'e yazıyordu (`tasks` tablosuna bir kayıt +
    `conversations`), ama gerçek alışveriş motoru (teklif toplama, seçenek kurma, escrow
    fonlama, sipariş durumları) hâlâ tamamen bridge'in SQLite'ında ve mock chain'de
    çalışıyordu; `merchant_acceptances`/`reservations`/`task_orders`/`escrows` (Postgres)
    tabloları sadece şema olarak duruyordu, hiçbir runtime kodu onlara yazmıyordu. Faz I bu
    boşluğu kapatıyor — kullanıcıya bu ayrım açıkça anlatıldı ve aşamalı ilerlemeye
    (§1 → §2 → §3-4 → §5) karar verildi.
45. **merchant-agents'ın SQLite→Postgres geçişi "least invasive" ilkesiyle bir
    `MerchantStore` arayüzü üzerinden yapıldı**, mevcut SQLite path'i hiç değiştirmeden:
    `SqliteMerchantStore` mevcut `db.ts`/`orders.ts` mantığını birebir sarmalıyor (tüm
    testler değişmeden geçiyor), `PostgresMerchantStore` `DATABASE_URL` set'ken devreye
    giriyor. Quotes/nonces/idempotency/payments_seen bilinçli olarak SQLite-only kaldı
    (plans/faz-i.md §1'in tablo listesinde yok — ephemeral/operasyonel state, domain data
    değil).
46. **Wire ID olarak numeric `merchantId` (1-5, `SEED_MERCHANTS`) korundu, Postgres'in
    uuid `org.id`'si sadece packages/db repo katmanının iç FK detayı kaldı.** Bu, quote/
    option/EIP-712/web kodunun HİÇBİRİNİN değişmesini gerektirmedi — `PostgresMerchantStore`
    slug↔numeric-id eşlemesini `SEED_MERCHANTS`'tan okuyup dış arayüzü (MerchantRow şekli)
    SQLite ile birebir aynı tutuyor.
47. **Postgres modunda esnaf cüzdanı da HER ZAMAN imzalayan anahtardan türetilir**
    (`privateKeyToAccount(signerKey).address`), Postgres'in `merchant_wallets` tablosundaki
    kayıtlı adresten DEĞİL — Faz C'de SQLite path için bulunan aynı sınıf bug'ın (#36)
    Postgres path'teki ikizi; `seed-pg.ts` adresi tek seferlik dev-key'den yazıyor, gerçek
    bir `MERCHANT_<SLUG>_PRIVATE_KEY` env'de belirdiği an o kayıt bayatlıyor.
48. **Atomik stok rezervasyonu, `SELECT ... FOR UPDATE` yerine tek bir
    `UPDATE ... WHERE available_quantity >= qty` deseniyle yapıldı.** Kurulu drizzle-orm
    sürümü (0.36.4) satır kilitleme query builder API'si sunmuyordu; ayrıca bu desen zaten
    daha basit ve race-free — Postgres aynı satıra eşzamanlı UPDATE'leri serialize eder,
    WHERE guard'ı kaybeden isteğin sıfır satır etkilemesini garanti eder.
    `packages/db/test/merchant.test.ts`'te 10 eşzamanlı rezervasyon isteğiyle (stok=2)
    doğrulandı — tam 2'si başarılı, 8'i `InsufficientStockError`.
49. **`reservations.quote_id` ve `task_orders.quote_id` FK'leri kasıtlı olarak farklı
    şekillerde ele alındı.** merchant-agents'ın kendi rezervasyon akışı `quoteId`'yi hiç
    Postgres'e yazmıyor (bridge'in yazmadığı `quotes_seen` satırlarına FK vermemek için;
    eşleştirme onun yerine en-eski-önce sırayla yapılıyor). Bridge'in `task_orders.quote_id`
    yazması gerektiğinde ise (§2 kabul akışı), tersine, kabul penceresini açmadan HEMEN
    ÖNCE o spesifik teklifi kendi SQLite'ından okuyup Postgres `quotes_seen`'e mirror'lıyor
    (`onConflictDoNothing`) — FK'yi atlamak yerine gerçekten dolduruyor, çünkü bu durumda
    veri zaten elde ve doğru olan bu.
50. **Escrow fonlamasının alıcısı artık gerçekten kullanıcının bağlı cüzdanı**
    (Faz C'nin `accounts`/`wallets` tablosundan, `getAccountView` ile) — bridge'in kendi
    session wallet'ı değil. AGENTS.md kural #2'nin ("Escrow yalnızca merchant_confirmed
    sonrasında ve kullanıcının kendi cüzdanından fonlanır") harfiyen uygulanışı: bağlı
    cüzdan bulunamazsa (olmaması gereken bir durum, Faz C SIWE girişinden sonra) görev
    açıkça `failed` olur, sessizce yanlış adrese fonlanmaz.
51. **Bridge, fund tx'ini KENDİSİ imzalamıyor — kullanıcının tarayıcıdan gönderdiği tx'i
    sadece `chain.getEscrow(escrowOrderId)` ile zincirden okuyup escrow satırıyla
    çapraz kontrol ediyor** (buyer/amount/quoteHash/pickupCodeHash/state). Ayrı bir
    "verifyFundTx" zincir metodu icat etmeye gerek kalmadı — `EvmChainProvider.getEscrow()`
    zaten Faz B'de mevcuttu (bir view call), hem mock hem gerçek modda çalışıyor, bu da
    `MockChainProvider` üzerinden gerçek zincir/anvil olmadan uçtan uca test edilebilmesini
    sağladı (`apps/local-agent-bridge/test/acceptance.test.ts`).
52. **Merchant konsolu bildirim sesi `notify.mp3` değil `notify.wav` oldu.** Spec dosya adı
    olarak mp3 öneriyordu; sıfırdan geçerli bir MP3 encode etmek bir encoder kütüphanesi
    gerektiriyor, WAV ise byte seviyesinde üretilebilen basit bir format ve tarayıcı
    `Audio` API'sinde birebir aynı şekilde çalıyor. ~15KB, <100KB sınırının çok altında.
53. **`taskSnapshot()`'a mevcut mock `orders` alanına DOKUNMADAN yeni bir `pgOrders` alanı
    eklendi** — web `NEXT_PUBLIC_MOCK` bayrağına göre ikisinden birini render ediyor
    (`EscrowBoard` mock için, `PgOrdersBoard`+`FundingWizard` gerçek mod için). Bu, Faz
    C/I boyunca tekrarlanan "postgres-optional, additive" desenin web tarafındaki karşılığı.
54. **Bilinen, kasıtlı olarak bırakılan boşluk: Postgres akışında konsolide makbuz
    (`finalize()`) henüz üretilmiyor.** `finalize()` hâlâ sadece bridge'in SQLite
    `task_orders` tablosunu okuyor; Postgres yolunda her sipariş doğru şekilde
    `completed`'e ulaşıyor (SSE `order_update` + `task_orders_settled` event'i ile
    haber veriliyor) ama tek bir makbuz belgesi oluşmuyor. Bu, Faz K'nın ödenmiş
    zaman çizelgesi transkriptine komşu, doğal bir takip işi olarak bırakıldı —
    yarım/bozuk bir makbuz üretmektense boşluğu açıkça işaretlemek tercih edildi.
55. **Kabul kriterlerinin ikisi bu oturumda doğrulanamadı, ikisi de Faz B'nin
    fonlanmamış olmasıyla aynı sebepten blokeli:** (a) gerçek anvil/Foundry entegrasyon
    testi — mevcut `acceptance.test.ts` `MockChainProvider` üzerinden AYNI kod yollarını
    (kabul→red→saga→fund→verify→prepare→ready→pickup→escrow Released) uçtan uca
    kanıtlıyor, ama gerçek `OrderEscrow` kontratına karşı değil; (b) iki-tarayıcı-profili
    manuel e2e (MetaMask'ta approve+fund görünmesi, esnaf konsolunda zil çalması) —
    spec'in kendi tanımına göre zaten kullanıcının işi. Her iki eksik de Faz B'nin
    testnet cüzdanlarının fonlanmasını bekliyor.

## Live-version (V2) — Faz J

56. **`PaymentProvider.pay()`/`PaymentHandle` sync'ten async'e geçti** — mock
    davranış değişmedi (hâlâ anında döner), ama gerçek ödeme artık gerçek bir zincir
    transferi olduğundan (broadcast + 1 confirmation) senkron kalamazdı. Tek etkilenen
    dosya `paymentClient.ts` oldu; orchestrator zaten `paidFetch`'i `await`'liyordu.
57. **`ArcPaymentProvider` bütçe/limit kontrollerini ZİNCİRE HİÇBİR ŞEY GÖNDERMEDEN ÖNCE**
    yapıyor (görev bütçesi, istek başı tavan, görev başı ödeme sayısı, farklı esnaf
    sayısı, session wallet'ın günlük limiti) — bir transfer mine olduktan sonra geri
    alınamaz, o yüzden `cancel()` yalnızca YEREL muhasebeyi düzeltebilir
    (bridge'in SQLite `spend` satırını 'refunded' işaretler), zincirdeki parayı asla
    geri çekemez. Bu, "ağ hatası sonrası ödeme" senaryosunda bilinen, dokümante
    edilmiş bir risktir — gerçek x402/402 sistemlerinin doğası.
58. **Cüzdan başına nonce sıralaması Redis `SET NX PX` kilidiyle yapıldı**, ayrı bir
    kuyruk/worker sistemi kurmak yerine — tek bir bridge process'i tüm ödemeleri
    zaten sırayla işlediği için (aynı anda tek bir `pay()` çağrısı aktif), kilit
    esas olarak GELECEKTEKİ çoklu-instance senaryosuna karşı bir güvenlik ağı;
    bugünkü mimaride pratikte hep boş bulunuyor.
59. **Merchant'ın gerçek ödeme doğrulaması `from` alanını platform-api'ye sormadan,
    doğrudan zincirdeki `Transfer` log'undan okuyarak yapıyor** (spec'in "ikisinden
    basit olanı seç" notu) — esnafın önemsediği şey doğru tutarda/doğru tokenle/
    doğru adrese ödeme yapılmış olması; KİMİN ödediği (session wallet mülkiyeti)
    ödeyenin/platform-api'nin muhasebe kaygısı, esnafın değil. Bu HTTP round-trip'ini
    ve platform-api'ye bir bağımlılığı tamamen ortadan kaldırdı.
60. **Replay koruması Postgres `payment_proofs` UNIQUE(chainId, txHash)'e taşındı**
    (mock modun SQLite `payments_seen`'i yerine) — bir tx hash zincir-geneli gerçek
    bir olgu olduğu için, tek bir merchant process'inin kendi SQLite'ı yeterli
    değildi; artık `tryConsumePaymentProof`'un `onConflictDoNothing().returning()`
    deseni (satır gerçekten eklendi mi?) atomik "ilk gelen kazanır" garantisi veriyor.
61. **`ENDPOINT_PRICES_MICRO.order` tamamen kaldırıldı, ama `/merchant/:id/order`
    ucu SİLİNMEDİ** — sadece ücretsiz hale geldi (gate kaldırıldı, merchant/rawBody
    manuel okunuyor). Mock hızlandırma yolu hâlâ bu ucu çağırıyor (artık ücretsiz),
    gerçek akış zaten Faz I'nin kabul akışından geçtiği için bu ucu hiç çağırmıyor.
    `quote` ucu de SİLİNMEDİ (`quote-basket` yanına eklendi, onun yerini almadı) —
    hem kendi testleri hem de invaziflik ilkesi bunu gerektirdi.
62. **`prepTimeMin` quote-basket yanıtında sabit 15 dakika** — Postgres şemasında
    gerçek bir `merchant_settings.prep_time_min` kolonu var ama SQLite mock şemasında
    karşılığı yok; bu faz kapsamında bir şema/store değişikliği eklemek yerine sabit
    değer kullanıldı, dokümante edildi. Düşük risk: sadece bilgilendirici bir alan,
    hiçbir karar mantığı buna dayanmıyor.
63. **`negotiate` ücret iadesinde esnafın GERÇEK bir geri-transfer atması (Faz J §2'nin
    "esnaf cüzdanından geri transfer" notu) bu turda uygulanmadı** — `x-fee-refunded`
    header'ı hâlâ çalışıyor ve bridge'in yerel bütçe muhasebesini doğru şekilde
    krediliyor (asıl kullanıcı-görünür etki bu), ama merchant tarafında gerçek bir
    zincir tx'i tetiklenmiyor. Spec'in kendisi de bunu "mainnet tasarımı
    faz-sonrası" olarak nitelendirmişti; testnet'te gas maliyeti önemsiz olduğu
    için düşük öncelik — bilinen bir takip işi.
64. **Session wallet AES-256-GCM şifreleme/çözme + Postgres round-trip canlı olarak
    doğrulandı** (round-trip eşleşmesi, adres eşleşmesi, sahiplik lookup'ı, günlük
    harcama birikimi, dondurulmuş cüzdanın harcamayı reddetmesi — hepsi gerçek
    Postgres'e karşı çalıştırıldı, ephemeral bir smoke script ile). `ArcPaymentProvider`'ın
    UÇTAN UCA gerçek bir zincir transferiyle doğrulanması hâlâ Faz B'nin fonlanmasını
    bekliyor — mock chain üzerinden mantık zaten tam olarak test edildi
    (bkz. Faz I'nin `acceptance.test.ts`'i aynı desenle §4'ü kanıtlamıştı).
