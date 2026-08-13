# Faz 0 — Bağlayıcı Kararlar + Shared Paket Güncellemeleri

> Bu faz çoğunlukla karar sabitlemedir; kod işi `packages/shared` ile sınırlıdır.
> Buradaki her "KARAR" sonraki tüm fazlar için bağlayıcıdır.

## 1. KARAR — Sipariş durum makinesi (v2, nihai)

Sipariş (task_order) durumları ve geçişleri:

```
quoted            → user_selected | expired | cancelled
user_selected     → merchant_pending | cancelled
merchant_pending  → merchant_confirmed | merchant_rejected | expired(accept-timeout) | cancelled
merchant_confirmed→ awaiting_funding
awaiting_funding  → paid_in_escrow | cancelled(funding-timeout → rezervasyon release)
paid_in_escrow    → preparing | refunded | disputed
preparing         → ready | refunded(prep-timeout) | disputed
ready             → completed | refunded | disputed
disputed          → completed | refunded
completed | refunded | cancelled | expired | merchant_rejected  → terminal
```

Zaman kuralları (saniye, env ile override edilebilir, bunlar varsayılan):

| Sabit | Değer | Anlam |
|---|---|---|
| `MERCHANT_ACCEPT_WINDOW_SEC` | 120 | merchant_pending → timeout |
| `FUNDING_WINDOW_SEC` | 600 | awaiting_funding → timeout, rezervasyon release |
| `PREP_DEADLINE_SEC` | 3600 | escrow releaseDeadline ufku |
| `RESERVATION_TTL_SEC` | 600 | stok kilidi TTL |
| `QUOTE_VALIDITY_SEC` | 300 | imzalı teklif TTL (mevcutla aynı) |

Kritik ilke: **escrow, yalnızca `merchant_confirmed` sonrasında ve kullanıcının kendi
cüzdanından fonlanır.** Esnaf kabul etmeden kullanıcının parası hiçbir koşulda kilitlenmez.

## 2. KARAR — Veritabanı mimarisi

- Tek PostgreSQL veritabanı (`merchantmesh`), tek schema (`public`), tablolar
  `LIVE_PLAN_V2.md §17` listesine göre.
- ORM/migration: **Drizzle ORM + drizzle-kit**, yeni workspace paketi **`packages/db`**.
  Tüm tablo tanımları ve migration'lar yalnızca bu pakette yaşar; servisler `@merchantmesh/db`
  üzerinden repository fonksiyonları kullanır. Servislerin içinde ham `CREATE TABLE` yasak.
- Extension'lar: `postgis`, `vector` (pgvector). Konum kolonları `geography(Point, 4326)`.
- Yazma sahipliği (hangi servis hangi tabloyu yazar):
  - platform-api → accounts, wallets, sessions, user_profiles, location_preferences,
    conversations, conversation_messages, saved_prompts, support_tickets, audit_logs
  - agent-runtime (bridge'in evrimi) → agents, agent_profiles, agent_memories, tasks,
    task_orders, quotes_seen, payment_events(araştırma), receipts
  - merchant-agents → merchant_* tabloları, products, merchant_products, warehouses,
    inventory, inventory_movements, reservations, merchant_acceptances, campaigns*
  - worker → chain_cursors, job_runs, outbox_events + reconciliation güncellemeleri
  Okuma serbesttir; çapraz yazma yasaktır.
- SQLite (`node:sqlite`) yalnızca mevcut mock/test path'lerinde kalır; yeni özellik SQLite'a
  yazılmaz. Mevcut vitest suite'leri kırılmaz.
- Redis: aktif görev state cache'i, session-wallet nonce kuyruğu kilidi, rate limit.
  Redis hiçbir finansal kaydın source of truth'u değildir.

## 3. KARAR — Zincir politikası (EVM-generic, hedef Arc testnet)

- Env adları zincirden bağımsız: `CHAIN_RPC_URL`, `CHAIN_ID`, `CHAIN_NAME`,
  `CHAIN_EXPLORER_URL`, `USDC_ADDRESS`, `ESCROW_ADDRESS`, `DIRECTORY_ADDRESS`,
  `RECEIPT_ADDRESS`, `RELAYER_PRIVATE_KEY`, `CHAIN_MIN_CONFIRMATIONS` (varsayılan 1).
  Eski `BASE_SEPOLIA_RPC_URL` adı kullanımdan kalkar (`.env.example` güncellenir).
- Arc testnet parametreleri koda gömülmez; Faz B'de güncel resmi kaynaktan doğrulanıp
  `.env` + `contracts/deployments/` altına yazılır. Arc erişiminde engel çıkarsa aynı kod
  Base Sepolia ile ilerler (sadece env değişir) — bu bir yedek yoldur, kod çatalı değildir.
- EIP-712 domain'i: `chainId` artık sabit 84532 değil, `CHAIN_ID` env'inden gelir.
  `packages/shared/src/eip712.ts` fonksiyonları `chainId` parametresi alacak şekilde
  güncellenir (aşağıda kod işi #3).
- İşlem doğrulama: her önemli tx (fund, release, refund, transfer) için
  `CHAIN_MIN_CONFIRMATIONS` beklenir; `payment_events` benzersizliği
  `(chainId, txHash, logIndex)`.

## 4. KARAR — x402 v2 ödeme sözleşmesi (gerçek transfer)

402 yanıtındaki payment requirements (zod şeması shared'a eklenir):

```jsonc
{
  "x402": {
    "scheme": "erc20-transfer",       // pilot: düz USDC transferi
    "network": "<CHAIN_NAME>",        // ör. "arc-testnet"
    "chainId": 0,
    "asset": "<USDC_ADDRESS>",
    "amountMicroUsdc": 500,
    "payTo": "0x…",                    // esnaf cüzdanı
    "endpoint": "/merchant/<slug>/quote-basket",
    "reason": "…",
    "idempotencyKey": "…",
    "expiresAt": 1750000000            // unix saniye, now+600
  }
}
```

Ödeme kanıtı (`X-Payment` başlığı, base64url JSON):

```jsonc
{ "kind": "tx", "txHash": "0x…", "from": "0x…", "idempotencyKey": "…" }
```

Merchant doğrulaması (hepsi zorunlu):
1. `txHash` RPC'den çekilir; `CHAIN_MIN_CONFIRMATIONS` sağlanmış olmalı.
2. ERC-20 Transfer log'u: `token == USDC_ADDRESS`, `to == payTo`, `value == amountMicroUsdc`.
3. `from`, ödemeyi yapan hesabın **kayıtlı session wallet adresi** olmalı (platform-api'den
   doğrulanır ya da istek imzalı session ile gelir).
4. Replay koruması: `payment_proofs` tablosunda `(chainId, txHash)` UNIQUE — ikinci kullanım 402.
5. `expiresAt` geçmişse 402.
Idempotency davranışı mevcutla aynı kalır (aynı key+payload → cached replay, yeni ödeme
istenmez; farklı payload → 409).

## 5. KARAR — Auth: SIWE (EIP-4361)

- viem'in SIWE yardımcıları kullanılır (`createSiweMessage`, `parseSiweMessage`,
  `verifySiweMessage`) — ayrı `siwe` paketi eklenmez.
- Akış: `POST /auth/nonce` (nonce DB'de, TTL 5 dk, tek kullanımlık) → istemci SIWE mesajı
  imzalar (domain, uri, chainId, nonce, issuedAt) → `POST /auth/verify` → doğrulama →
  `sessions` kaydı → `HttpOnly; Secure; SameSite=Lax` cookie.
- `sessions` tablosunda ham token değil `tokenHash` (sha256) tutulur. Logout revoke eder.
- İlk kez görülen cüzdan: `accounts` + `wallets` + `agents` + `agent_profiles` kayıtları
  tek transaction'da oluşur.

## 6. KARAR — Session wallet tehdit modeli (pilot, testnet-only)

- Hesap başına bir session wallet; private key **AES-256-GCM** ile şifrelenir, anahtar
  `SESSION_WALLET_MASTER_KEY` env'inden (32 byte, base64). Ham key hiçbir log/DB/env
  dosyasına düz yazılmaz.
- Limitler (env ile ayarlanabilir varsayılanlar): maksimum bakiye 20 USDC, görev başına
  0.01 USDC, gün başına 0.05 USDC, görev başına maksimum 8 mikro-ödeme, en fazla 3 ücretli
  esnaf.
- `TESTNET_ONLY=true` iken bilinen mainnet chainId'lerine (1, 8453 vb.) işlem imzalamak
  kodda reddedilir.
- Cüzdan başına tek transaction kuyruğu (nonce sırası) — Redis kilidi ile.
- Tüm imzalama olayları `audit_logs`'a yazılır. Acil dondurma: `accounts.status='frozen'`
  → imzalama reddedilir.

## 7. Kod işleri (bu fazda yapılacaklar)

1. `packages/shared/src/schemas.ts`:
   - `OrderState` enum'unu v2 listesiyle değiştir (`user_selected`, `merchant_pending`,
     `merchant_confirmed`, `merchant_rejected`, `awaiting_funding` eklenir; `reserved` ve
     `approved` kalkar). `ORDER_TRANSITIONS` tablosunu §1'e göre yeniden yaz.
   - `PaymentRequirements`'ı x402 v2 şemasıyla değiştir (§4); `PaymentProofTx` şeması ekle.
     Eski HMAC `PaymentProof` mock testleri için `MockPaymentProof` adıyla kalır.
2. `packages/shared/src/constants.ts` (yeni): §1'deki zaman sabitleri + §6'daki limit
   varsayılanları, hepsi `env`-override'lı okuyucularla.
3. `packages/shared/src/eip712.ts`: `QUOTE_DOMAIN` sabit chainId yerine
   `quoteDomain(chainId: number)` fonksiyonu; `signQuote/verifyQuoteSignature/hashQuote`
   chainId parametresi alır. Mevcut çağrı yerleri (merchant quotes.ts, bridge orchestrator,
   testler) güncellenir — mock/test path'lerinde `chainId=84532` kalabilir.
4. Merchant + bridge'deki state geçiş noktaları yeni enum'a uyarlanır; mevcut mock akış
   çalışmaya devam eder (mock akışta `user_selected→merchant_pending→merchant_confirmed`
   otomatik geçilir ki 32 test + demo bozulmasın; gerçek kabul UI'ı Faz I'da gelir).
5. `.env.example`: `CHAIN_*` bloku, `SESSION_WALLET_MASTER_KEY`, `TESTNET_ONLY`,
   `DATABASE_URL`, `REDIS_URL` (değerler boş/örnek).

## Kabul kriterleri

- [ ] `pnpm test` ve `pnpm -r typecheck` yeşil (mevcut 32 test uyarlanmış haliyle geçer).
- [ ] `pnpm demo` hâlâ uçtan uca tamamlanır (mock akış yeni state adlarıyla).
- [ ] `canTransition` testleri yeni makineyi doğrular (özellikle: `awaiting_funding`
      öncesi escrow fonlanamaz; `merchant_pending`'ten `paid_in_escrow`'a direkt geçiş yok).
- [ ] Shared'da x402 v2 şemaları ve sabitler mevcut; hiçbir yerde float para yok.
