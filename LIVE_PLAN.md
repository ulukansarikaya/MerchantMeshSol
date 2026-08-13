# MerchantMesh — Canlı Sürüm Planı (Arc Ağı)

> **ARŞİV NOTU:** Bu, EVM-uyumlu **Arc testnet** için yazılmış bir uygulama planıydı ve bu
> haliyle hayata geçirilmedi — proje daha sonra tamamen **Solana**'ya taşındı (farklı bir
> zincir ailesi: EVM/viem/wagmi/MetaMask değil, Anchor/Ed25519/wallet-adapter). Aşağıdaki
> içerik, o dönemde yapılan planı olduğu gibi kayıt altında tutar; güncel mimari ve
> gerçekleşen canlı sürüm akışı için [AGENTS.md](AGENTS.md) ve [README.md](README.md)'ye
> bakın.

> Bu doküman, mevcut MerchantMesh kod tabanının **mock'suz, Arc testnet üzerinde canlı çalışan,
> cüzdan-hesaplı ve kişisel agent'lı** sürüme dönüştürülmesinin uygulama planıdır.
> Kaynak: `AGENT_MAHALLE_EKLEME_NOTLARI.md` (Aşama 1 kapsamı) + canlı-öncelikli sadeleştirmeler.

---

## 0. Alınan Kararlar

| Konu | Karar |
|---|---|
| LLM / AI planlama | **Şimdilik boş bırakılıyor.** `llmProvider` adaptörü duruyor; canlıda deterministik kural-tabanlı planlayıcı çalışacak (SKU eşleme). Gerçek LLM endpoint'i sonradan tek env değişkeniyle bağlanacak, kod değişikliği gerekmeyecek. |
| Repo | Mevcut **MerchantMesh** reposunun üstüne geliştirilecek (github.com/ulukansarikaya/MerchantMesh). |
| Ağ | **Arc testnet** (Circle L1, EVM uyumlu, USDC-native). RPC URL / chain ID / faucet bilgileri build sırasında güncel kaynaktan doğrulanacak ve `.env`'e yazılacak. |
| Mock | Zincir, ödeme, escrow, esnaf işlemleri: **mock yok, hepsi gerçek tx.** Esnaf/ürün verisi elle girilecek (bu mock değil, gerçek veri girişi). |
| Teslimat | Sadece **gel-al** (teslim kodu modeli). Kurye kapsam dışı. |
| Kapsam dışı (şimdilik) | ZK kanıtları, şifreli hafıza + Merkle root, kampanya motoru, PostGIS/rota, kurye, satıcı rolleri (Owner dışında), batch settlement. Bunlar `AGENT_MAHALLE_EKLEME_NOTLARI.md`'de bekliyor. |

---

## 1. Hedef Kullanıcı Akışı (canlıda birebir böyle çalışacak)

1. Kullanıcı siteye girer → **Cüzdan Bağla** (MetaMask) → Arc testnet'e geçiş istenir.
2. Backend tek kullanımlık **nonce** üretir → kullanıcı mesajı imzalar → imza doğrulanır → oturum açılır.
3. Cüzdan ilk kez görülüyorsa otomatik olarak: **hesap + cüzdan kaydı + kişisel agent kimliği** oluşur.
4. Kullanıcı alışveriş isteğini yazar → kendi agent'ı SKU planı çıkarır → yakın esnaflar keşfedilir.
5. Her esnaf sorgusu (teklif/pazarlık/rezervasyon) **Arc üzerinde gerçek USDC mikro-transferi** ile ödenir — araştırma bütçesi limiti kodda korunur.
6. Seçenekler sunulur → kullanıcı seçer → **kendi cüzdanından** `approve + fund` ile dükkan başına escrow fonlar (MetaMask onayları).
7. Esnaf yeni siparişi konsolda **sesli bildirimle** görür → **Kabul Et** (60–120 sn penceresi; kabul edilmezse escrow fonlanmaz, para hiç kilitlenmez).
8. Hazırlanır → müşteri gelir → **teslim kodu** girilir → escrow zincir üstünde esnafa geçer.
9. Kullanıcı panelinde: konuşma geçmişi, sipariş geçmişi, ödeme dökümü, makbuz — hepsi hesabına bağlı, kalıcı.

---

## 2. Yapılacak İşler (uygulama sırasına göre)

### Faz A — Arc zinciri ve gerçek para *(temel)*

- [ ] Arc testnet parametrelerini doğrula (RPC, chainId, explorer, USDC adresi, faucet) → `.env.example` güncelle.
- [ ] Foundry kur / alternatif deploy yolu → **OrderEscrow, MerchantDirectory, OrderReceipt** kontratlarını Arc testnet'e deploy et.
- [ ] Deployer/relayer için yeni anahtar üret; esnaf cüzdanları için gerçek test anahtarları üret (sunucuda tutulur).
- [ ] `BaseSepoliaProvider` → `ArcProvider` olarak gerçek viem implementasyonu: fund doğrulama, refund, receipt yazma, escrow okuma.
- [ ] Esnaf servisi `chainClient`: `markPreparing / markReady / confirmPickup` gerçek tx.
- [ ] Mock chain endpoint'leri (`/chain/*`) ve `MockChainProvider` devre dışı (kod silinmez, env ile kapanır).

### Faz B — Cüzdan girişi ve hesap sistemi

- [ ] Web'e **wagmi + viem**: cüzdan bağlama, ağ değiştirme, imza isteme.
- [ ] Bridge'e auth uçları: `POST /auth/nonce`, `POST /auth/verify` (imza doğrulama, session token), `POST /auth/logout`.
- [ ] Yeni tablolar: `accounts`, `wallets`, `sessions`, `agents`, `agent_profiles`.
- [ ] İlk girişte otomatik hesap + kişisel agent oluşturma; tüm task'lar `accountId + agentId`'ye bağlanır.
- [ ] Mevcut "simüle cüzdan widget'ı" → gerçek cüzdan durumu (adres, Arc USDC bakiyesi, ağ kontrolü).

### Faz C — Escrow fonlamasını kullanıcının cüzdanına taşıma

- [ ] Fonlama akışı sunucudan **frontend'e** taşınır: seçenek onayı → dükkan başına `USDC.approve` + `escrow.fund` (wagmi `writeContract`).
- [ ] Bridge tx hash'i alır, zincirden doğrular, esnafa bildirir, durumu izler.
- [ ] Timeout iadeleri relayer anahtarıyla otomatik (`refund` deadline sonrası herkes çağırabilir — mevcut kontrat kuralı).

### Faz D — Mikro ödemeler (x402, gerçek)

- [ ] `MockPaymentProvider` yerine **ArcPaymentProvider**: her ücretli esnaf isteği için sunucu tarafındaki *session wallet*'tan esnaf cüzdanına gerçek USDC transferi; tx hash ödeme kanıtı olur, esnaf zincirden doğrular.
- [ ] Session wallet: kullanıcı hesabı başına üretilen, kullanıcının küçük miktar USDC yatırdığı sıcak cüzdan (araştırma bütçesi = bakiyesi). Bütçe/istek-başı limitler aynen korunur.
- [ ] `payment_events` defteri: tüm mikro ödemeler + escrow hareketleri tx hash'leriyle hesaba işlenir.

### Faz E — Merchant-accept + bildirim + geçmiş ekranları

- [ ] State machine'e `merchant_confirmed` adımı: escrow, esnaf kabulünden **sonra** fonlanır; kabul penceresi dolarsa sipariş düşer, para kilitlenmez.
- [ ] Esnaf konsoluna sesli bildirim (Web Push + tekrarlayan ses) ve Kabul Et / Reddet ekranı.
- [ ] Kullanıcı paneli: konuşma geçmişi (`conversations` + `conversation_messages`), sipariş geçmişi, ödeme dökümü, "Sorun bildir" formu (manuel çözüm — kontrat `dispute/resolve` zaten hazır).
- [ ] Kaydedilmiş promptlar (basit liste; şablon motoru sonra).

### Faz F — Canlıya alma

- [ ] Web → Vercel; bridge + merchant servisleri → tek VPS (pm2/systemd).
- [ ] SQLite canlıda kalır (tek sunucu, düşük hacim için yeterli; Postgres migrasyonu kullanıcı artınca).
- [ ] `.env` üretim değerleri, CORS/HTTPS ayarları, esnaf verilerinin elle girilmesi (5 gerçek kayıt).
- [ ] Uçtan uca gerçek test: cüzdan bağla → imzala → sipariş → MetaMask ile fonla → esnaf kabul → teslim kodu → zincirde release → makbuz.

---

## 3. Veri Modeli Ekleri (Faz B/E ile gelen yeni tablolar)

```text
accounts            (id, createdAt, status)
wallets             (address PK, accountId, firstSeenAt, lastLoginAt)
sessions            (token, accountId, walletAddress, expiresAt)
agents              (agentId, accountId, name, createdAt)
agent_profiles      (agentId, prefsJson)          ← yapısal tercihler; hafıza motoru sonra
conversations       (id, accountId, title, status, createdAt, updatedAt)
conversation_messages (id, conversationId, role, content, messageType, createdAt)
saved_prompts       (id, accountId, text, createdAt)
payment_events      (id, accountId, merchantId, taskId, orderId, type, direction,
                     amountMicroUsdc, status, txHash, network, idempotencyKey, createdAt)
support_tickets     (id, accountId, orderId, type, description, status, createdAt)
```

Mevcut `tasks / task_orders / quotes_seen / spend` tabloları `accountId` kolonu alır.

---

## 4. Değişmeyenler

- Kanonik SKU listesi, zod şemaları, EIP-712 imzalı teklifler (domain chainId → Arc olarak güncellenir).
- Deterministik fiyat/pazarlık/rezervasyon kuralları, idempotency, araştırma bütçesi zorlaması.
- Sipariş durum makinesi (+ `merchant_confirmed` eklenir), teslim kodu → escrow release modeli.
- Üç servisli mimari (web / bridge / merchants) ve tasarım token'lı UI.

## 5. Kullanıcıdan Gerekenler (build sırasında istenecek)

1. MetaMask kurulu cüzdan.
2. Arc testnet faucet'inden test USDC + (gerekiyorsa) gas token — adresler netleşince adımları vereceğim.
3. Deployer/relayer adresine faucet'ten fon (adresi ben üretip vereceğim).
4. LLM bağlanacağı gün: endpoint/anahtar (`AGY_BASE_URL` veya eşdeğeri) — koda dokunmadan.

## 6. Riskler

| Risk | Önlem |
|---|---|
| Arc testnet parametreleri/faucet erişimi değişken | Build başında güncel doğrulama; kod EVM-generic, gerekirse aynı gün Base Sepolia'ya alınıp Arc'a taşınabilir |
| Frontend'e taşınan fonlamada yarım kalan akış (approve verildi, fund iptal) | Fonlama sihirbazı adım adım durum tutar; fund gelmezse sipariş `merchant_confirmed`'da bekler ve düşer, para kilitlenmez |
| Session wallet anahtarı sunucuda | Düşük bakiye tavsiyesi + bakiye üst limiti + tek kullanıcıya bağlı izole anahtar |
| Esnaf konsolu açık değilken sipariş | Merchant-accept penceresi + fonlamanın kabul sonrasına alınması bu riski parasal olarak sıfırlar |
