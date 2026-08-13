# MerchantMesh — Proje Brief

**Tek cümle:** Yerel çalışan bir Next.js/Hono uygulaması; Türkçe yazılan bir alışveriş isteğini AI agent SKU listesine çevirir, çevredeki esnaf agent'larından **her istekte ödeme yaparak** (x402 tarzı mikro-ödeme) teklif toplar, kullanıcı onayından sonra **Solana üzerinde on-chain escrow**'a parayı kilitler ve **teslim kodu doğrulaması** ile serbest bırakır.

---

## 1. Amaç ve Kapsam

- Kullanıcı Solana cüzdanı bağlar (veya mock modda simüle oturum cüzdanı kullanır), Türkçe bir istek yazar ("4 kişilik köfte yapacağım, gidip alacağım").
- Yerel AI agent (Antigravity/AGY adaptörü veya mock) isteği kanonik ürün kodlarına (SKU) çevirir.
- Agent, mesafeye göre yakın esnaf agent'larını keşfeder (Haversine).
- Her esnaf isteği (teklif, pazarlık, rezervasyon, envanter sorgusu) **ayrı ayrı ücretlidir** — x402 tarzı HTTP 402 handshake.
- 2–3 alışveriş seçeneği sunulur: **En Ucuz / En Kaliteli / Gel-Al Rotası**.
- Kullanıcı seçip onaylayınca, her esnaf için **ayrı bir on-chain escrow** (Solana `order_escrow` programı) fonlanır.
- Esnaf, müşteri geldiğinde tek kullanımlık **teslim kodunu** girer → escrow serbest kalır.
- Sonunda **birleşik makbuz**: araştırma harcaması, ana ödeme, tamamlanan kalem/dükkan sayısı, tx referansları.
- Canlı sürümde (Faz 2/3), esnaflar kendi hesaplarından self-service olarak yeni bir esnaf/ürün/envanter oluşturabilir ve operatör onayıyla zincire yayınlanabilir; pazarlığa açık esnaflarda ilk teklif LLM destekli (ama daima deterministik olarak sınırlanan) bir indirim içerebilir.

---

## 2. Değişmez Kurallar (Non-Negotiable)

1. Her agent-to-agent esnaf isteği ödemelidir; nihai satın alma kullanıcı onaylıdır.
2. LLM asla fiyat/stok üretmez ve nihai indirim asla doğrudan LLM çıktısından gelmez — Faz 3'ten itibaren LLM bir indirim *önerisi* üretebilir ama bu öneri her zaman `pricingPolicy.ts`'nin deterministik sınırlarından (max indirim bps, min fiyat) geçer.
3. Tüm fiyatlar **USDC-native**, integer micro-USDC (6 ondalık) — float veya TL yok.
4. Teklifler esnafın kendi Solana cüzdanıyla **Ed25519 imzalıdır**, `validUntil` (+300sn) ve nonce taşır; süresi geçmiş/yerini almış teklifler sipariş anında reddedilir.
5. Her ödemeli istek bir `Idempotency-Key` taşır — aynı key+payload → cache'ten yanıt; aynı key+farklı payload → 409.
6. Araştırma bütçesi kodda zorlanır: toplam 0.01 USDC, istek başı max 0.002 USDC — her mikro-ödemeden önce (bekleyenler dahil) kontrol edilir.
7. Escrow, teslim kodu doğrulamasıyla serbest kalır; manuel kullanıcı serbest bırakma sadece yedek buton olarak var; zaman aşımları otomatik iade tetikler.
8. **Mock-first**: `MOCK_PAYMENTS=true`, `MOCK_CHAIN=true`, `AI_PROVIDER=mock` ile uçtan uca çalışır. Gerçek entegrasyonlar (AGY, x402 facilitator, Solana devnet) env ile açılan adaptörlerin arkasında.

---

## 3. Mimari

```
/apps/web                   Next.js 15 + TS + Tailwind v4          :3000
/apps/local-agent-bridge    Hono/Node — kişisel AI agent            :3001
/apps/platform-api          Hono/Node — Solana cüzdan girişi,
                             merchant self-service + admin (canlı)  :3002
/apps/merchant-agents       Hono/Node — sabit 5 esnaf + self-service :4000
/solana                      Anchor workspace — merchant_directory,
                             order_escrow, order_receipt (devnet'e deploy edildi)
/packages/shared              zod şemaları, kanonik SKU'lar, Ed25519 quote imzaları,
                             PDA/instruction yardımcıları, USDC yardımcıları
/packages/db                  Drizzle/Postgres şeması (canlı sürüm)
/scripts                      seed.ts, demo.ts, seed-pg.ts, chain-smoke.ts, init-devnet.ts
```

- **pnpm workspaces**, TypeScript strict, her istek gövdesi zod ile doğrulanıyor.
- **Depolama**: mock modda Node'un yerleşik `node:sqlite` modülü (Node ≥ 23.4 şart) — servis başına bir DB dosyası, idempotency tablosu dahil. Canlı sürümde Postgres + Redis (bkz. README.md).

### 3.1 Local AI Bridge (:3001)
- `llmProvider.ts`: `AI_PROVIDER=agy|mock`. Mock mod deterministik plan üretir (demo prompt'ları tanır); agy modu yerel Antigravity endpoint'ine OpenAI-uyumlu chat-completions ile bağlanır.
- Orkestrasyon: framework'süz, tipli durum makinesi — plan → keşif → ödemeli teklif toplama → bütçe içinde mikro-aksiyonlar (kalite skoru, pazarlık, rezervasyon) → 2–3 seçenek → kullanıcı seçimi → escrow fonlama (zorunlu kalemler önce; hata → alternatif esnaf → opsiyonel kalem düşür → iptal+iade) → yerleşim izleme → makbuz.
- Uçlar: `POST /tasks`, `GET /tasks/:id/events` (SSE), `POST /tasks/:id/select-option`, `POST /tasks/:id/approve-payment`.

### 3.2 Merchant Agents (:4000)
5 sabit esnaf (Ankara/Kızılay merkezli), artı self-service ile eklenen esnaflar (canlı sürüm):

| Esnaf | Kategori | Mesafe | Kalite | Pazarlık | Rezervasyon |
|---|---|---|---|---|---|
| Ali Kasap | Kasap | 172 m | 9.1 | ✓ | – |
| Can Kasap | Kasap | 305 m | 7.2 | ✓ | – |
| Zeynep Manav | Manav | 342 m | 8.4 | ✓ | – |
| Cem Fırın | Fırın | 387 m | 8.8 | – | ✓ (son 2 ekmek demo) |
| Mini Market | Market | 378 m | 6.9 | – | – |

Her esnaf uç noktası ücretlidir: `ask` 0.0002 · `inventory` 0.0003 · `quote` 0.0005 · `negotiate` 0.002 · `reserve` 0.001 · `order` 0.001 USDC. `ready` ve `verify-pickup` esnaf konsolu için ücretsiz.

Pazarlığa açık esnaflarda (`negotiation.enabled`), `quote` isteği artık düz liste fiyatı yerine `discountProvider.ts` (LLM öneri) → `pricingPolicy.ts` (deterministik kırpma) hattından geçer; hata/timeout/rate-limit durumunda indirimsiz teklife düşer, her karar loglanır.

### 3.3 x402 Ödeme Akışı
Ödemesiz istek → HTTP `402` + `{amountMicroUsdc, asset, network, payTo, endpoint, reason, idempotencyKey}` → bridge ödeme kanıtıyla tekrar dener. `PaymentProvider` arayüzü: `MockPaymentProvider` (varsayılan — bütçeyi SQLite'ta düşer, HMAC kanıt üretir) / gerçek mod (Solana SPL Token transferi, tx signature kanıt olarak doğrulanır).

Esnaf servisindeki tek bir `setInterval` worker: süresi geçen teklifleri kapatır, rezervasyonları stoğa iade eder, deadline geçen escrow'ları iade eder, SSE event'i yollar.

---

## 4. Zincir Katmanı (Anchor / Solana, devnet)

- **order_escrow** — `fund` (SPL Token CPI transferi, alıcı imzalı), `mark_preparing`/`mark_ready` (sadece esnaf cüzdanı), `confirm_pickup(order_id, code)` (`keccak256(code)` eşleşirse serbest bırakır), `refund` (alıcı iptal / deadline sonrası herkes), `user_release` (yedek, sadece alıcı), `resolve` (arbiter = relayer yetkisi, MVP anlaşmazlık çözümü).
- **merchant_directory** — hafif on-chain esnaf kaydı (`list_merchant`, `set_merchant_wallet`), relayer anahtarına yetki-kısıtlı.
- **order_receipt** — görev başına birleşik makbuz, relayer tarafından yazılır.
- **ChainProvider adaptörü**: `MockChainProvider` (mock modda SQLite'ta simüle eder, varsayılan) / gerçek Solana RPC client'ları (`packages/shared/src/solana`), env eksikse mock'a düşer.

Program ID'leri EVM'deki gibi env'den okunmaz — build zamanında `declare_id!`/IDL'e gömülüdür. Üç program da gerçek Solana devnet'e deploy edildi ve `pnpm chain:smoke` ile uçtan uca (fund → prepare → ready → confirm/refund) doğrulandı.

---

## 5. Sipariş Durum Makinesi

```
quoted → user_selected → merchant_pending → merchant_confirmed → awaiting_funding →
paid_in_escrow → preparing → ready → completed
```
Çıkışlar: `expired` (TTL), `refunded` (iptal/timeout/deadline), `cancelled`, `merchant_rejected`, `disputed → refunded|released|closed`. Her geçiş `stateLog`'a eklenir ve SSE üzerinden yayınlanır. Escrow yalnızca `merchant_confirmed` sonrası fonlanır (mock modda `DATABASE_URL` yokken bu zincir tek adımda `awaiting_funding`'e hızlandırılır).

---

## 6. Frontend Akışı (:3000)

Cüzdan bağlantısı (mock modda simüle oturum cüzdanı widget'ı + bütçe göstergesi, canlı modda Solana wallet-adapter — Phantom/Solflare) → prompt kutusu → canlı SSE zaman çizelgesi → mesafe+doğrulama rozetli esnaf keşif listesi → TTL sayaçlı imzalı teklif kartları → **En Ucuz / En Kaliteli / Gel-Al Rotası** seçenek kartları → seçim → son onay → dükkan başına escrow zaman çizelgesi (Funded→Preparing→Ready→Released/Refunded) → **esnaf konsolu** (sipariş panosu + kod doğrulama) → birleşik makbuz sayfası → yıldız+etiket geri bildirim.

Canlı sürümde ayrıca **Esnaf Paneli** (`/merchant-dashboard`) — esnafların kendi hesaplarından yeni esnaf/ürün/envanter oluşturup yayınlayabildiği self-service arayüz; esnaf konsolundan (`/merchant`, sipariş kabul/teslim) ayrı bir rota.

Tasarım tek bir token dosyasında (`app/globals.css`) — renk/tipografi değişimi komponentlere dokunmadan yapılabilir.

---

## 7. Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Monorepo | pnpm workspaces, TypeScript strict |
| Web | Next.js 15, React 19, Tailwind v4 |
| Backend servisler | Hono (Node) |
| Veritabanı | Mock: Node yerleşik `node:sqlite` · Canlı: Postgres + PostGIS + pgvector, Redis |
| Doğrulama | Zod |
| İmza/kripto | Ed25519 (Solana native) — `@solana/kit` |
| Zincir | Solana (Anchor / Rust programları) |
| Test | Vitest (TS tarafı) + `cargo test`/litesvm (`/solana` Rust tarafı) |

---

## 8. Proje Durumu

Mock-mode MVP (M1–M7), canlı sürüm altyapısı (Faz A–J: Postgres, Solana cüzdan girişi,
esnaf kabul akışı, gerçek session-wallet ödemeleri) ve esnaf self-service + LLM destekli
fiyatlama (Faz 2/3) tamamlandı ve gerçek Solana devnet üzerinde uçtan uca doğrulandı
(esnaf oluşturma → yayınlama → zincirde PDA doğrulama → imzalı teklif alma).

**Güncel durum için:** [AGENTS.md](AGENTS.md) — mimari, değişmezler ve env değişkenleri
her fazdan sonra güncel tutulan tek kaynak. `pnpm test` + `pnpm -r typecheck` her fazın
kabul kriteri.

---

## 9. Nasıl Çalıştırılır

```bash
pnpm i
pnpm db:seed
pnpm dev              # web :3000, bridge :3001, platform-api :3002, merchants :4000
```

Tarayıcıda **http://localhost:3000** açılır. Demo prompt hazır gelir; akışı takip edip **Esnaf Konsolu**'ndan teslim kodlarını doğrulayarak süreci tamamlayabilirsiniz.

Diğer komutlar:
```bash
pnpm demo             # köfte demo — script'li Mini Market hatası dahil
pnpm demo:timeout     # prep-timeout otomatik iade demo
pnpm test             # tüm vitest paketleri
pnpm -r typecheck     # workspace genelinde strict TS kontrolü
pnpm chain:smoke      # gerçek Solana devnet üzerinde escrow akışı testi
```

---

## 10. Belgeler

- [README.md](README.md) — kurulum, mimari detay, gerçek mod bağlantı noktaları.
- [AGENTS.md](AGENTS.md) — AI coding agent'ları için güncel mimari/kural rehberi (tek güncel kaynak).
- [DECISIONS.md](DECISIONS.md), [LIVE_PLAN.md](LIVE_PLAN.md), [LIVE_PLAN_V2.md](LIVE_PLAN_V2.md) — EVM/Arc-testnet döneminden kalma tarihsel karar/plan kayıtları; mimari o zamandan beri Solana'ya taşındı, bkz. üstlerindeki arşiv notu.
- [.env.example](.env.example) — tüm ortam değişkenleri.
