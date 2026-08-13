# Faz J — Gerçek Ücretli Sorgular: Session Wallet + ArcPaymentProvider + quote-basket

> Önkoşul: Faz 0, A, B, C, I. Bu fazın sonunda araştırma mikro-ödemeleri de gerçek zincir
> transferidir; HMAC mock yalnızca vitest'te kalır. Omurga bu fazla tamamlanır.

## 1. Session wallet servisi (platform-api)

- Hesap başına bir session wallet: ilk ihtiyaçta üretilir (`session_wallets` tablosu Faz
  A şemasında: accountId UNIQUE, address, encryptedKey, createdAt, frozenAt).
- Anahtar saklama: AES-256-GCM, `SESSION_WALLET_MASTER_KEY` (32B base64) ile envelope;
  IV+tag kayıtta. Master key yoksa servis başlamaz (canlıda). Ham key hiçbir yerde loglanmaz.
- Uçlar (session'lı):
  - `GET /session-wallet` → adres, on-chain USDC bakiyesi, günlük harcama, limitler.
  - `POST /session-wallet/withdraw { to }` → tüm USDC bakiyesini kullanıcının ana
    cüzdanına gönderir (yalnızca hesabın kayıtlı cüzdanına — serbest adres YOK).
- Yatırma: kullanıcı MetaMask'tan session wallet adresine USDC gönderir (web'de
  "Araştırma cüzdanına yükle" kartı: adres + hazır transfer butonu wagmi ile).
- Limit zorlaması (Faz 0 §6 sabitleri): max bakiye 20 USDC (aşan yatırma UI'da uyarılır),
  görev başı 0.01, gün başı 0.05, görev başı ≤8 ödeme, ≤3 ücretli esnaf. `TESTNET_ONLY`
  zorlaması imzalama katmanında.
- Nonce kuyruğu: cüzdan başına Redis kilidi altında sıralı gönderim; başarısız tx'te nonce
  senkronu RPC'den yenilenir. Tüm imzalamalar `audit_logs`'a.

## 2. `ArcPaymentProvider` (bridge, PaymentProvider implementasyonu)

- `pay(taskId, requirements)`:
  1. Bütçe kontrolleri (mevcut mantık aynen: pending dahil toplam + istek-başı tavan;
     ek olarak görev başı ödeme sayısı ve günlük limit).
  2. Session wallet kuyruğuna USDC `transfer(payTo, amount)` → 1 confirmation bekle.
  3. `payment_events(type=research_fee, direction=debit, txHash…)` yaz.
  4. Proof döndür: `{ kind:"tx", txHash, from, idempotencyKey }` (Faz 0 §4).
- Ücret iadesi (negotiate fee-refund): merchant `x-fee-refunded` verdiğinde merchant
  servisi esnaf cüzdanından geri transfer atar; bridge iade tx'ini doğrulayıp
  `payment_events(credit)` yazar. KARAR: iade eşiği zaten fee'den büyük indirimlerde
  oluyor; iade tx gas maliyeti testnette önemsiz — mainnet tasarımı Faz-sonrası.
- 402 çıktısı: merchant `paymentGate` Faz 0 §4 payload'ını üretir (`expiresAt=now+600`).
- Merchant doğrulaması (`payments.ts`): Faz 0 §4'teki 5 kontrol; `from` doğrulaması için
  platform-api'ye internal lookup (`GET /internal/session-wallet-owner?address=`) veya
  imzalı session — ikisinden basit olanı seç, dokümante et.

## 3. `quote-basket` konsolidasyonu

- Yeni paid uç: `POST /merchant/:id/quote-basket` — fiyat: 0.0005 USDC (quote ile aynı).
  Tek ücretli çağrıda döner: stok uygunluğu (stockHints), birim fiyatlar, imzalı sepet
  teklifi (mevcut EIP-712 Quote — chainId env'den), hazırlama süresi
  (merchant_settings.prepTimeMin), rezervasyon uygunluğu (reservation.enabled + scarce).
- Orchestrator artık `quote` yerine `quote-basket` çağırır; ayrı `ask`(quality) çağrısı
  kalkar — kalite skoru quote-basket yanıtında gelir (deterministik, merchant kaydından).
  `inventory` ucu ile `ask` ucu paid olarak kalır ama omurga akışında kullanılmaz.
- Bütçe planı yeni akışta (varsayılanlarla): 3 × quote-basket (0.0015) + 1 × negotiate
  (0.002) + 1 × reserve (0.001) = 0.0045 ≤ 0.01. Sipariş "order fee" KALKAR (kabul akışı
  Faz I'da ücretsiz oldu) — `ENDPOINT_PRICES_MICRO`'dan order çıkarılır, testler güncellenir.
- Aday daraltma: keşif (ücretsiz) → kategori + mesafe → en fazla **3** ücretli quote-basket
  (Faz 0 limitleri). Orchestrator sabitleri `constants.ts`'ten okur.

## 4. Web görünürlüğü

- Bütçe göstergesi artık session wallet gerçeğini gösterir: bakiye, bu görevde harcanan,
  kalan; her mikro ödeme timeline'da explorer linkiyle.
- Session wallet boşsa görev başlatılamaz; "yükle" kartına yönlendirilir.

## Kabul kriterleri

- [ ] Manuel e2e (Arc testnet): görev başlat → 3 quote-basket transferi explorer'da
      görünür → pazarlık iadesi (senaryo kuruluysa) geri transfer olarak düşer →
      seçim → kabul → fonlama → release → makbuzdaki araştırma dökümünde gerçek tx hash'leri.
- [ ] Replay testi: aynı txHash ile ikinci istek 402 (`payment_proofs` UNIQUE).
- [ ] Sahte proof testi: başka tokena/alıcıya/tutara ait tx reddedilir.
- [ ] Limit testleri: görev başı 9. ödeme bloklanır; 4. esnaf sorgusu bloklanır; günlük
      limit dolunca yeni görev ödemesi bloklanır (saat manipülasyonu ile test).
- [ ] Bütçe muhasebesi: `payment_events` toplamı = zincirdeki transfer toplamı
      (reconciliation script'i `scripts/ledger-check.ts` ile doğrulanır).
- [ ] Mock HMAC path yalnızca test suite'lerinde; canlı env'de kod yolu seçilemiyor.
