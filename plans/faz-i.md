# Faz I — Merchant Kabul Akışı + Kullanıcı Cüzdanından Escrow Fonlama

> Önkoşul: Faz 0, A, B, C. Bu fazda araştırma mikro-ödemeleri HÂLÂ mock (HMAC) çalışabilir —
> gerçeğe geçiş Faz J'dedir. Bu fazın konusu: seçim sonrası akışın tamamen gerçek olması.

## 1. Merchant servisinin Postgres'e taşınması (önkoşul işi)

- merchant-agents kalıcılığı `@merchantmesh/db`'ye geçer: merchant_*, products,
  merchant_products, inventory(+movements), reservations, merchant_acceptances,
  task_orders(okuma). SQLite path'i yalnızca vitest için kalır (mevcut testler kırılmaz —
  storage arayüzü çıkarılıp iki implementasyon tutulabilir; en az invaziv yol seçilsin).
- Rezervasyon artık atomik Postgres transaction'ı + row lock (`SELECT … FOR UPDATE`):
  `available -= qty, reserved += qty` + `inventory_movements(reserve)` + `reservations` kaydı.
  CHECK constraint'ler Faz A'dan hazır.

## 2. Kabul akışı (merchant_pending → merchant_confirmed)

- Kullanıcı seçenek seçince (bridge `selectOption`): her dükkan için `task_orders` kaydı
  `merchant_pending` durumunda açılır + `merchant_acceptances(status=pending,
  expiresAt=now+MERCHANT_ACCEPT_WINDOW_SEC)`.
- Merchant konsol uçları (session'lı, o organizasyonun sahibi olmalı — Faz C middleware):
  - `GET /console/acceptances` → bekleyenler
  - `POST /console/acceptances/:id/accept` → atomik: stok rezervasyonu yap (yetersizse
    `reject(reason=out_of_stock)` döner) → order `merchant_confirmed` → bridge'e bildirim
  - `POST /console/acceptances/:id/reject` → order `merchant_rejected`
- Timeout worker: penceresi dolan pending kabul → `expired`; bridge'e bildirim.
- Bridge: TÜM dükkanlar `merchant_confirmed` olunca task → `awaiting_funding` + SSE
  `funding_ready` event'i (dükkan başına: escrowAddress, usdcAddress, amountMicroUsdc,
  merchantId, quoteHash, pickupCodeHash, releaseDeadline). Reddedilen dükkan olursa mevcut
  saga kuralları: alternatif esnaf → opsiyonelse düşür → zorunluysa görev iptal
  (rezervasyonlar release).
- Pickup kodu ÜRETİMİ bu faza taşınır: kod, kabul sonrası funding_ready hazırlanırken
  bridge'de üretilir ve kullanıcıya escrow panosunda gösterilir (mevcut davranış korunur).

## 3. Konsol sesli bildirimi

- Merchant konsolu SSE veya 3 sn'lik poll ile bekleyen kabul sayısını izler; yeni kabul
  düştüğünde Web Audio ile tekrarlayan zil sesi çalar (sayfada "sesi kapat" düğmesi).
  Ses dosyası repo içinde küçük bir asset olarak durur (public/notify.mp3, <100KB).

## 4. Fonlama sihirbazı (web)

- `awaiting_funding` durumunda kullanıcıya dükkan başına adım adım sihirbaz:
  1. `USDC.approve(escrow, amount)` — mevcut allowance yeterliyse atlanır
     (`allowance` view kontrolü).
  2. `escrow.fund(merchantId, amount, quoteHash, pickupCodeHash, releaseDeadline)`
  3. txHash → `POST /tasks/:id/funding-tx { orderId, txHash }` → bridge `verifyFund`
     (Faz B) → doğrulanınca order `paid_in_escrow`, merchant'a bildirim, SSE.
- Sihirbaz durumu kalıcıdır: sayfa yenilense de `awaiting_funding`'teki dükkanlar ve
  hangilerinin fonlandığı task snapshot'ından gelir; kullanıcı kaldığı yerden devam eder.
- Funding timeout worker'ı: `FUNDING_WINDOW_SEC` dolunca fonlanmamış dükkan siparişi
  `cancelled` + rezervasyon release; fonlanmış dükkanlar etkilenmez (kullanıcıya net
  gösterilir). Zorunlu bir dükkan fonlanmadan iptal olduysa saga kuralı uygulanır.
- `userRelease` fallback butonu artık kullanıcı cüzdanından `writeContract` atar
  (bridge değil) ve tx bridge'e bildirilir.

## 5. Değişen merchant "order" ucu

- Mevcut paid `POST /merchant/:id/order` ucunun sorumluluğu değişir: sipariş kaydı artık
  kabul akışıyla oluştuğundan, bu uç Faz J'deki `quote-basket` konsolidasyonuna kadar
  yalnızca quote→order bağlama + pickupCodeHash kaydı yapar. Escrow'un `internal/escrow-funded`
  webhook'u kalkar; yerine bridge doğrulama-sonrası `POST /internal/order-funded` çağırır
  (orderId, escrowOrderId, txHash).

## Kabul kriterleri

- [ ] Entegrasyon testi (anvil üzerinde — Foundry Faz B'de kuruldu): seçim → 2 dükkan kabul,
      1 dükkan ret → alternatif/düşürme sagası → kabul edenler için gerçek fund tx (test
      anahtarıyla) → verifyFund → paid_in_escrow → verify-pickup → zincirde release.
- [ ] Kabul penceresi timeout testi: kabul edilmeyen sipariş expired, rezervasyon stoğa döndü.
- [ ] Funding timeout testi: fonlanmayan sipariş cancelled, rezervasyon release, fonlanmış
      dükkan etkilenmedi.
- [ ] Stok yarışı testi: aynı ürüne eşzamanlı iki rezervasyon → biri kazanır, invariant bozulmaz.
- [ ] Manuel e2e (Arc testnet): iki tarayıcı profili (müşteri + esnaf) ile tam akış; esnaf
      konsolunda zil çalıyor, MetaMask'ta approve+fund görünüyor, explorer linkleri gerçek.
