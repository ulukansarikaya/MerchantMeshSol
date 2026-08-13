# plans/ — Canlı Sürüm Uygulama Spec'leri

Bu klasör, `LIVE_PLAN_V2.md`'nin **uygulanabilir faz spec'lerini** içerir. Her dosya kendi
kendine yetecek şekilde yazılmıştır: hangi dosyalar oluşturulacak/değişecek, hangi kararlar
bağlayıcı, kabul kriterleri neler.

## Kullanım (model devri)

- Planlama **Fable** tarafından yapıldı; uygulama başka bir modelle (ör. Sonnet) yürütülür.
- Uygulayıcı modele tek cümle yeter: **"plans/faz-0.md'yi uygula"**.
- Uygulayıcı model her fazın sonunda: `pnpm test` + `pnpm -r typecheck` yeşil olmalı,
  kabul kriterleri sağlanmalı, iş tek commit olarak atılmalı (push kullanıcı onayıyla).
- Spec'te "KARAR" olarak işaretlenen maddeler tartışmaya kapalıdır — uygulayıcı model bunları
  değiştirmez; sorun görürse işi durdurup gerekçesiyle kullanıcıya bildirir (Fable'a
  danışılır), kendi kafasına göre alternatif uygulamaz.
- `AGENTS.md`'deki değişmez kurallar her fazda geçerlidir.

## Faz sırası

**Omurga (canlıya çıkaran çekirdek — bu klasörde spec'i hazır):**

| Sıra | Dosya | Konu |
|---|---|---|
| 1 | `faz-0.md` | Bağlayıcı kararlar: state machine, DB mimarisi, x402 v2, auth, chain politikası + shared paket güncellemeleri |
| 2 | `faz-a.md` | PostgreSQL + PostGIS + pgvector + Redis temeli, `packages/db`, migration + seed |
| 3 | `faz-b.md` | Arc testnet: kontrat deploy, gerçek ChainProvider'lar, chain smoke testi |
| 4 | `faz-c.md` | Cüzdan girişi (SIWE), hesap + kişisel agent oluşturma, platform-api |
| 5 | `faz-i.md` | Merchant kabul akışı + kullanıcı cüzdanından escrow fonlama sihirbazı |
| 6 | `faz-j.md` | Gerçek ücretli sorgular: session wallet, ArcPaymentProvider, quote-basket |

**Sonraki fazlar** (omurga canlıda çalışınca spec'leri yazılacak — `LIVE_PLAN_V2.md`
bölümlerine bakınız): D (merchant onboarding), E (ürün/stok paneli), F (kampanya motoru),
G (gerçek LLM + hafıza), H (PostGIS + gerçek yaya rotası), K (geçmiş/finans/destek
ekranları), L (worker/mutabakat/bildirim), M (canlıya alma + hardening).

## Omurga sonu hedef durum

Kullanıcı MetaMask ile Arc testnet'e bağlanır, imzayla giriş yapar (hesap + kişisel agent
otomatik oluşur), alışveriş isteği yazar, agent gerçek USDC mikro-ödemeleriyle en fazla 3
esnaftan teklif toplar, kullanıcı seçer, esnaflar kabul eder, kullanıcı kendi cüzdanından
escrow fonlar, esnaf teslim kodunu doğrulayınca ödeme zincir üstünde serbest kalır ve her
şey hesabın kalıcı geçmişine yazılır. LLM henüz bağlı değildir (deterministik planlayıcı);
kampanya, hafıza ve gerçek rota sonraki fazlardadır.
