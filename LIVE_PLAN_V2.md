# MerchantMesh — Güncellenmiş Canlı Sürüm Planı v2 (Arc Ağı)

> **ARŞİV NOTU:** Bu plan da (LIVE_PLAN.md gibi) EVM-uyumlu **Arc testnet** için yazıldı ve bu
> haliyle uygulanmadı — proje sonradan tamamen **Solana**'ya taşındı. Buradaki satıcı
> organizasyonları/ürün-stok-kampanya/self-service fikirlerinin çoğu daha sonra farklı bir
> teknik temelle (Postgres + Solana Anchor programları, Faz 2/3) gerçekten hayata geçirildi —
> ama uygulama detayları (cüzdan bağlama, imzalama, zincir çağrıları) burada anlatılandan
> tamamen farklıdır. Güncel mimari için [AGENTS.md](AGENTS.md) ve [README.md](README.md)'ye
> bakın; bu doküman yalnızca o dönemki planı kayıt altında tutar.

> Bu doküman, mevcut MerchantMesh kod tabanının Arc testnet üzerinde gerçek cüzdan, gerçek USDC işlemleri, kişisel AI agent hafızası, satıcı organizasyonları, ürün–stok–kampanya yönetimi ve konuma dayalı yaya alışveriş deneyimiyle çalışan sürüme dönüştürülmesinin uygulama planıdır.
>
> Kaynaklar: `PROJECT_BRIEF.md`, `LIVE_PLAN.md` ve `AGENT_MAHALLE_EKLEME_NOTLARI.md`.

---

## 0. Planın Konumu ve Hedefi

Bu sürüm yalnızca bir zincir veya ödeme demosu değildir. Hedef; aşağıdaki çekirdek ürün döngüsünü gerçek veriler ve gerçek testnet işlemleriyle çalıştırmaktır:

```text
Cüzdanla giriş
→ kişisel agent ve hafıza yükleme
→ doğal dil alışveriş isteği
→ SKU planı
→ kullanıcının konumuna göre yaya erişilebilir satıcı keşfi
→ gerçek stok ve kampanya sorgusu
→ ücretli agent-to-agent teklif toplama
→ kişiye uygun seçeneklerin sıralanması
→ satıcı kabulü
→ kullanıcının escrow fonlaması
→ hazırlama
→ teslim kodu
→ zincir üstünde ödeme serbest bırakma
→ konuşma, sipariş ve ödeme geçmişine kayıt
```

### Bu sürüme dahil

- Gerçek LLM planlama ve kişiselleştirme
- Kullanıcıya özel mantıksal agent kimliği
- Yapısal tercih hafızası ve episodik agent hafızası
- Konuşma, prompt, sipariş ve ödeme geçmişi
- Satıcı hesabı ve merchant organization modeli
- Satıcı ürün kataloğu paneli
- Depo ve stok yönetimi
- Kampanya yönetimi
- Şeffaf, kurala dayalı kişiye özel kampanyalar
- PostgreSQL, PostGIS ve pgvector
- Gerçek yaya rota mesafesi ve yürüme modu
- Arc testnet üzerinde gerçek USDC mikro ödemeleri
- Kullanıcının cüzdanından gerçek escrow fonlaması
- Satıcı kabulü, teslim kodu ve zincir üstü release

### Bu sürümde kapsam dışı

- Kurye ve teslimat filosu
- Çoklu mağazadan kurye toplama
- ZK kanıtları
- Şifreli hafıza vault’u ve on-chain Merkle root
- Batch settlement
- Owner dışındaki gelişmiş satıcı rolleri için tam yetki ekranları
- Çok şubeli ve çok depolu ileri operasyonlar

Kurye kapsam dışında bırakılmıştır. Bu sürümün konum deneyimi **yürüme + gel-al** üzerine kurulacaktır.

---

## 1. Temel Ürün ve Güvenlik Kararları

| Konu | Karar |
|---|---|
| LLM | Gerçek LLM bu sürüme dahildir. `AI_PROVIDER=agy|openai-compatible|mock` adaptörü korunur. Canlı ortamda gerçek sağlayıcı kullanılır; testlerde mock kullanılır. |
| LLM yetkisi | LLM fiyat, stok, kampanya tutarı, ödeme, mesafe veya sipariş durumu üretemez. Bunları yalnızca deterministik araçlardan alır. |
| Agent modeli | Kullanıcı başına ayrı çalışan model kurulmaz. Her hesap için ayrı `agentId`, profil, hafıza, izin ve araç kapsamı oluşturulur; ortak runtime çağrı sırasında bu bağlamı yükler. |
| Repo | Mevcut MerchantMesh monoreposu üzerinde geliştirilecektir. |
| Ağ | Arc testnet hedeflenir. RPC, chain ID, explorer, USDC ve faucet bilgileri uygulama başlamadan güncel resmi kaynaktan doğrulanır. Zincir katmanı EVM-generic kalır. |
| Gerçek işlemler | Canlı testnet akışında zincir, mikro ödeme, escrow ve release gerçek transaction’dır. Mock adaptörler yalnızca otomatik test ve yerel geliştirme için korunur. |
| Veri tabanı | PostGIS ve pgvector gereksinimi nedeniyle canlı sürüm PostgreSQL’e geçer. SQLite yalnızca yerel demo/test modu için kalır. |
| Teslimat | Yürüme ve gel-al vardır. Kurye yoktur. |
| Satıcı kabulü | Kullanıcı escrow fonlamadan önce satıcı siparişi kabul etmelidir. |
| Kişisel kampanya | Temel fiyat kullanıcıya göre yükseltilemez. Kişiselleştirme yalnızca şeffaf indirim, paket, sadakat veya uygunluk avantajı şeklinde uygulanır. |
| Mikro ödeme | Pilot sürümde her ücretli çağrı gerçek testnet USDC transferidir. İşlem sayısı bütçe, aday satıcı sayısı ve çağrı birleştirmesiyle sınırlandırılır. |
| Session wallet | Yalnızca testnet ve düşük bakiye için kullanılır. Üretim ana ağ tasarımı olarak kabul edilmez. |

---

## 2. Güncellenmiş Sistem Mimarisi

Mevcut üç servisli yapı, yeni hesap, hafıza, ürün, kampanya ve konum sorumlulukları için yetersiz kalacaktır. Monorepo aşağıdaki mantıksal sınırlara ayrılır:

```text
/apps/web
    Next.js kullanıcı ve satıcı arayüzü

/apps/platform-api
    Auth ve session
    Accounts ve wallets
    Merchant organizations
    Conversations ve saved prompts
    Payment ledger
    Products, inventory, warehouses
    Campaigns
    Location preferences
    Support tickets

/apps/agent-runtime
    Mevcut local-agent-bridge'in evrimi
    LLM provider
    Context builder
    Memory retrieval / memory writer
    Shopping planner
    Merchant discovery
    Paid quote orchestration
    Option scoring

/apps/merchant-agents
    Ücretli merchant endpoint'leri
    Deterministik stok ve teklif motoru
    Kampanya uygunluk motoru
    Rezervasyon ve sipariş işlemleri
    EIP-712 imzalama

/apps/worker
    Chain reconciliation
    Payment confirmation
    Offer/reservation expiration
    Inventory release
    Memory summarization
    Notification jobs

/contracts
    OrderEscrow
    MerchantDirectory
    OrderReceipt

/packages/shared
    Zod şemaları
    Canonical SKU
    EIP-712 tipleri
    USDC bigint yardımcıları
    Domain events
    Auth ve permission tipleri
```

İlk dağıtımda `platform-api`, `agent-runtime`, `merchant-agents` ve `worker` aynı VPS üzerinde ayrı process olarak çalışabilir. Servis sınırları kodda korunur; fiziksel olarak ayrı sunucular zorunlu değildir.

---

## 3. Veri Altyapısı

### 3.1 PostgreSQL

Aşağıdaki kesin ve ilişkisel veriler PostgreSQL’de tutulur:

- Hesaplar ve cüzdanlar
- Oturumlar
- Kullanıcı tercihleri
- Merchant organizations ve üyelikler
- Ürün kataloğu
- Depolar ve stok
- Kampanyalar
- Siparişler ve rezervasyonlar
- Teklifler
- Ödeme defteri
- Konuşmalar ve mesajlar
- Agent hafızaları
- Audit log

### 3.2 PostGIS

PostGIS aşağıdaki işlemler için kullanılır:

- Mağaza koordinatları
- Kullanıcının geçici keşif konumu
- Yarıçap ön filtresi
- Yakındaki satıcı sorguları
- Yürüme adaylarının coğrafi daraltılması
- İleride teslimat polygon’ları için altyapı

### 3.3 pgvector

pgvector yalnızca anlamsal içerik bulmak için kullanılır:

- İlgili episodik hafıza seçimi
- Önceki benzer alışverişlerin bulunması
- Konuşma başlığı ve özet araması

Aşağıdaki sorular vektör aramasıyla cevaplanmaz:

- Kullanıcı ne kadar harcadı?
- Stok kaç adet?
- Kampanya oranı nedir?
- Escrow serbest bırakıldı mı?

Bunlar doğrudan ilişkisel ve zincir verilerinden sorgulanır.

### 3.4 Redis

Redis aşağıdaki geçici ve eşzamanlı durumlar için kullanılır:

- Aktif agent görev durumu
- SSE/WebSocket fan-out
- Rate limit
- Nonce ve replay cache
- Session wallet transaction queue
- Kısa süreli merchant keşif cache’i
- Dağıtık kilitler

Redis finansal kayıtların source of truth’u değildir.

### 3.5 Object storage

- Ürün görselleri
- Sorun bildirim fotoğrafları
- Dışa aktarılan makbuz ve raporlar

---

## 4. Hesap, Cüzdan ve Oturum Sistemi

### 4.1 Giriş akışı

1. Kullanıcı MetaMask ile cüzdan bağlar.
2. Frontend doğru Arc ağına geçiş ister.
3. Backend tek kullanımlık nonce üretir.
4. Kullanıcı domain, URI, chain ID, nonce ve issued-at içeren giriş mesajını imzalar.
5. Backend imzayı, nonce’u, domain’i, chain ID’yi ve süreyi doğrular.
6. Cüzdan yeni ise hesap ve kişisel agent oluşturulur.
7. Tarayıcıya `HttpOnly`, `Secure`, uygun `SameSite` ayarlı session cookie verilir.

### 4.2 Session güvenliği

Veritabanında ham token tutulmaz:

```text
sessions
- id
- tokenHash
- accountId
- walletAddress
- createdAt
- expiresAt
- lastUsedAt
- revokedAt
- userAgentHash
```

Gereksinimler:

- Nonce tek kullanımlık ve kısa ömürlüdür.
- İmza mesajı farklı domain veya chain üzerinde tekrar kullanılamaz.
- Logout session’ı revoke eder.
- Cüzdan değişikliği yeni doğrulama gerektirir.
- Kritik işlemler için gerekirse yeniden imza istenir.

### 4.3 Hesap rolleri

Bir `account` aynı anda müşteri ve satıcı organizasyonu üyesi olabilir.

```text
Customer Mode | Merchant Mode
```

---

## 5. Kişisel AI Agent ve Gerçek LLM Kişiselleştirmesi

### 5.1 Agent bir model instance’ı değildir

Her üye için sürekli çalışan ayrı LLM kurulmaz. Aşağıdaki kalıcı nesneler oluşturulur:

```text
Agent
├── Agent Profile
├── Structured Preferences
├── Episodic Memories
├── Tool Permissions
├── Model Configuration
└── Conversation History
```

Bir görev geldiğinde ortak `agent-runtime` bu bilgileri yükler ve yalnızca o görev süresince agent context’i oluşturur.

### 5.2 Context Builder

Her LLM çağrısı şu sınırlı bağlamdan oluşturulur:

```text
System policy
+ agent rolü
+ aktif kullanıcı tercihi
+ ilgili 3–8 episodik hafıza
+ son konuşma mesajları
+ aktif alışveriş görevi
+ konum tercihi
+ tool sonuçları
+ araştırma bütçesi
```

Tüm konuşma geçmişi modele gönderilmez.

### 5.3 LLM çağrı stratejisi

İdeal bir alışveriş görevi:

```text
1. LLM çağrısı: doğal dil → ShoppingPlan / canonical SKU
0 LLM çağrısı: stok, fiyat, kampanya, rota ve ödeme hesapları
0–1 LLM çağrısı: seçenekleri kullanıcıya doğal dille açıklama
```

Merchant agent’ların stok ve teklif yanıtları LLM kullanmadan deterministik üretilir.

### 5.4 Tool zorunluluğu

LLM yalnızca aşağıdaki araçlarla doğrulanmış verilere erişir:

```text
searchNearbyMerchants
getWalkingRoute
getMerchantInventory
requestPaidBasketQuote
getCampaignEligibility
reserveItems
getPaymentHistory
getOrderHistory
saveUserPreferenceCandidate
```

LLM’in serbest metninden doğrudan fiyat, indirim, stok veya ödeme kaydı oluşturulamaz.

### 5.5 Model katmanları

- SKU çıkarma ve hafıza özetleme: küçük/hızlı model
- Karmaşık alışveriş planı: daha güçlü model
- Basit açıklama: küçük/orta model veya şablon
- Hata halinde: deterministik fallback planner

### 5.6 Prompt injection önlemleri

- Merchant verileri güvenilmeyen tool çıktısı olarak işaretlenir.
- Ürün açıklamaları system instruction gibi yorumlanmaz.
- Tool çağrıları allowlist ile sınırlandırılır.
- Ödeme ve sipariş mutasyonları LLM metniyle değil doğrulanmış state machine komutlarıyla yapılır.

---

## 6. Agent Hafızası

### 6.1 Hafıza türleri

#### Çalışma hafızası

Aktif görevin geçici state’i Redis ve PostgreSQL task tablolarında tutulur.

#### Yapısal tercih hafızası

Kesin ve düzenlenebilir tercihler:

- Maksimum yürüme mesafesi
- Maksimum yürüme süresi
- Fiyat/kalite dengesi
- Diyet ve alerji bilgileri
- Tercih edilen markalar
- Kaçınılan markalar
- Favori mağazalar
- Varsayılan araştırma bütçesi

#### Episodik hafıza

Önceki deneyimlerden çıkarılan bağlamsal kayıtlar:

```text
Kullanıcı önceki köfte alışverişinde Ali Kasap'ı kalite nedeniyle seçti.
Kullanıcı 20 dakikadan uzun yürüyüş seçeneğini reddetti.
Kullanıcı Zeynep Manav siparişine 5 yıldız verdi.
```

#### Finansal ve operasyonel geçmiş

Sipariş, ödeme, escrow ve stok verileri agent hafızası olarak değil kesin kayıt olarak tutulur.

### 6.2 Hafıza yazma politikası

Her kullanıcı cümlesi otomatik kalıcı tercihe dönüştürülmez.

```text
Konuşma veya sipariş tamamlanır
→ memory extractor aday kayıt üretir
→ tür ve güven skoru belirlenir
→ hassas veya uzun ömürlü tercihler için kullanıcı onayı istenir
→ süreli ya da kalıcı kayıt yazılır
```

### 6.3 Hafıza kaydı

```text
agent_memories
- id
- agentId
- memoryType
- content
- structuredKey
- structuredValueJson
- confidence
- sourceConversationId
- sourceMessageId
- sourceOrderId
- userConfirmed
- expiresAt
- embedding
- createdAt
- updatedAt
- deletedAt
```

### 6.4 Kullanıcı kontrolü

Kullanıcı panelinde **Agentımın Benim Hakkımda Bildikleri** alanı bulunur:

- Hafızayı gör
- Düzenle
- Sil
- Geçici yap
- AI erişimini kapat
- Kişiselleştirmeyi tamamen kapat

LLM’in gizli düşünme süreci saklanmaz. Yalnızca kullanıcıya gösterilen mesajlar, tool çağrı özetleri ve doğrulanabilir olaylar saklanır.

---

## 7. Satıcı Hesabı ve Merchant Organization

### 7.1 Organizasyon modeli

Satıcı tek bir cüzdan olarak değil organizasyon olarak modellenir:

```text
Merchant Organization
├── Store Profile
├── Owner Membership
├── Merchant Wallets
├── Products
├── Warehouses
├── Inventory
├── Campaigns
├── Orders
├── Payments
└── Agent Settings
```

İlk canlı sürümde yalnızca `Owner` rolü aktif olabilir; tablo tasarımı gelecekte şu rolleri destekler:

- Owner
- Manager
- Inventory Manager
- Order Operator
- Finance Viewer

### 7.2 Satıcı onboarding

1. Satıcı cüzdanla giriş yapar.
2. “Satıcı hesabı oluştur” adımına girer.
3. Mağaza adı, kategori, adres ve koordinat girer.
4. Ödeme alacak cüzdan doğrulanır.
5. Çalışma saatleri ve yürüme/gel-al ayarları girilir.
6. İlk ürünler eklenir.
7. Merchant agent kimliği ve EIP-712 signer ilişkisi oluşturulur.
8. Platform doğrulaması sonrası mağaza keşfe açılır.

### 7.3 Satıcı ana paneli

- Yeni siparişler
- Kabul bekleyen siparişler
- Hazırlanan siparişler
- Teslime hazır siparişler
- Escrow’da bekleyen tutar
- Serbest bırakılan ödemeler
- Mikro sorgu gelirleri
- Düşük stoklar
- Aktif kampanyalar
- Son agent sorguları
- Tekliften siparişe dönüşüm oranı

---

## 8. Satıcı Ürün Paneli

Her merchant ürünü canonical SKU ile eşleştirilir:

```text
merchant_products
- id
- merchantId
- canonicalSku
- merchantProductName
- description
- categoryId
- unitType
- unitSize
- basePriceMicroUsdc
- minimumPriceMicroUsdc
- costMicroUsdc
- qualityScore
- active
- imageObjectKey
- version
- createdAt
- updatedAt
```

Kurallar:

- Tüm tutarlar bigint/integer micro-USDC’dir.
- JavaScript `number` veya float kullanılmaz.
- Ürün fiyatı değiştiğinde `version` artar.
- Geçmiş tekliflerin fiyat snapshot’ı korunur.
- Ürün silinmez; pasif hale getirilir.

Satıcı paneli özellikleri:

- Ürün ekleme ve düzenleme
- Canonical SKU eşleme
- Fiyat belirleme
- Minimum fiyat belirleme
- Kalite etiketi
- Aktif/pasif durumu
- Ürün görseli
- Toplu CSV içe aktarma
- Fiyat değişim geçmişi

---

## 9. Depo ve Stok Yönetimi

### 9.1 Depo modeli

İlk sürüm tek mağaza–tek ana depo ile çalışabilir; veri modeli çoklu depoya hazır olur.

```text
warehouses
- id
- merchantId
- name
- address
- location geography(Point, 4326)
- active
```

### 9.2 Stok alanları

```text
inventory
- id
- warehouseId
- merchantProductId
- physicalQuantity
- reservedQuantity
- availableQuantity
- lowStockThreshold
- version
- updatedAt
```

Invariant:

```text
availableQuantity = physicalQuantity - reservedQuantity
availableQuantity >= 0
reservedQuantity >= 0
```

### 9.3 Stok hareketleri

```text
inventory_movements
- id
- inventoryId
- movementType
- quantityDelta
- sourceType
- sourceId
- note
- actorAccountId
- createdAt
```

Hareket türleri:

- stock_in
- sale
- reserve
- reservation_release
- manual_adjustment
- waste
- return

### 9.4 Rezervasyon işlemleri

Rezervasyon atomik transaction içinde yapılır:

```text
available yeterli mi?
→ inventory row lock
→ reservedQuantity artır
→ availableQuantity azalt
→ reservation kaydı
→ expiry worker
```

Sipariş tamamlanırsa fiziksel stok düşer. Sipariş iptal veya funding timeout olursa rezervasyon stoğa döner.

### 9.5 Stok paneli

- Mevcut, rezerve ve fiziksel stok
- Düşük stok uyarıları
- Stok hareket geçmişi
- Manuel düzeltme
- Fire/kayıp kaydı
- Hızlı toplu güncelleme
- Rezervasyon görünümü

---

## 10. Kampanya Yönetimi

### 10.1 Kampanya motoru deterministiktir

LLM kampanya önerebilir fakat fiyatı kendisi uygulayamaz. Satıcı onayından sonra kampanya kuralı deterministik motorda aktif olur.

### 10.2 Kampanya türleri

- Yüzde indirim
- Sabit tutar indirimi
- İkinci ürüne indirim
- Paket ürün
- Minimum sepet indirimi
- Belirli saat kampanyası
- Stok eritme kampanyası
- İlk sipariş kampanyası
- Sadakat kampanyası

### 10.3 Kampanya modeli

```text
campaigns
- id
- merchantId
- name
- description
- status
- startAt
- endAt
- totalUsageLimit
- perAccountUsageLimit
- stackPolicy
- priority
- version
- createdAt
- updatedAt
```

```text
campaign_rules
- id
- campaignId
- ruleType
- ruleJson
- discountType
- discountValue
- maximumDiscountMicroUsdc
```

```text
campaign_usage
- id
- campaignId
- accountId
- orderId
- discountMicroUsdc
- createdAt
```

### 10.4 Kişiye özel kampanya

Kişiselleştirme yalnızca açık kurallarla uygulanır:

```text
Son 30 günde en az 3 tamamlanmış sipariş
→ %5 sadakat indirimi

İlk tamamlanan sipariş
→ 0.500000 USDC indirim

Kullanıcının favori kategorisi + yüksek stok
→ paket kampanya gösterimi
```

Kesin kural:

```text
Herkese açık temel fiyat
+ kullanıcının hak kazandığı şeffaf indirim
= kişiye özel nihai teklif
```

Kullanıcının ödeme gücü, cüzdan bakiyesi veya tahmini gelirine göre gizli fiyat artırımı yapılamaz.

### 10.5 İmzalı teklif içeriği

```text
merchantId
customerWallet
itemsHash
baseAmountMicroUsdc
discountAmountMicroUsdc
finalAmountMicroUsdc
campaignIdsHash
campaignVersion
inventoryVersion
productPriceVersionsHash
nonce
validUntil
```

Sipariş anında stok, kampanya ve fiyat versiyonları yeniden doğrulanır.

---

## 11. Konum, PostGIS ve Gerçek Yaya Rotası

### 11.1 Konum izni

- Kullanıcıdan tarayıcı konum izni istenir.
- İzin verilmezse harita veya mahalle üzerinden manuel seçim yapılır.
- Keşif konumu ile teslimat adresi ayrıdır; bu sürümde teslimat adresi kullanılmaz.
- Kesin konum varsayılan olarak kalıcı saklanmaz.
- Kullanıcı isterse favori başlangıç noktası kaydedebilir.

### 11.2 Yürüme tercihleri

```text
location_preferences
- accountId
- maxWalkingDistanceM
- maxWalkingDurationMin
- defaultSearchRadiusM
- allowMultiStopRoute
- updatedAt
```

Varsayılanlar:

```text
maxWalkingDistanceM = 1000
maxWalkingDurationMin = 15
```

Kullanıcı panelinden değiştirilebilir.

### 11.3 İki aşamalı keşif

#### Coğrafi ön filtre

PostGIS ile yürüme limitinden biraz geniş bir kuş uçuşu alanı taranır:

```text
varsayılan gerçek yürüme limiti: 1 km
PostGIS ön filtre yarıçapı: 1.5 km
```

#### Gerçek rota doğrulaması

Ön filtreden geçen adaylar rota servisine gönderilir:

```text
walkingDistanceM
walkingDurationMin
routeGeometry
```

Son uygunluk gerçek yürüme mesafesi ve süresine göre belirlenir.

### 11.4 Rota sağlayıcı adaptörü

```text
RouteProvider
├── OpenRouteServiceProvider
├── MapboxProvider
├── GoogleRoutesProvider
└── MockRouteProvider (test)
```

Sağlayıcı env ile değiştirilebilir.

### 11.5 Çoklu mağaza rotası

Gel-al seçeneğinde:

```text
Başlangıç
→ Kasap
→ Manav
→ Fırın
→ Başlangıç veya bitiş
```

rotası oluşturulur. İlk sürümde aday mağaza sayısı en fazla 3 ile sınırlandırılır. Rota optimizasyonu toplam yürüme süresi, ürün tamamlama oranı ve fiyat ile birlikte skorlanır.

### 11.6 Kurye

Kurye bu sürümde bulunmaz. Arayüzde pasif veya “yakında” olarak gösterilebilir; gerçek kurye ücreti veya ETA üretilmez.

---

## 12. Ücretli Merchant Sorguları ve x402 Akışı

### 12.1 Protokol sınırı

Sistem yalnızca “USDC transferi yapılan endpoint” olarak bırakılmaz. Her ücretli endpoint şu akışı uygular:

```text
İlk istek
→ HTTP 402 Payment Required
→ payment requirements payload
→ istemci ödeme üretir
→ ödeme kanıtıyla aynı idempotent isteği tekrarlar
→ merchant doğrulama yapar
→ iş sonucu döner
```

Payment requirements en az şunları içerir:

```text
scheme
network
asset
authorizationAmountMicroUsdc
payTo
endpoint
reason
idempotencyKey
expiresAt
```

### 12.2 Pilot ödeme modeli

Pilot sürümde gerçek testnet USDC transferi kullanılır:

- Kullanıcı hesabına ait düşük bakiyeli session wallet
- Her wallet için izole transaction queue
- Tx hash + transfer log ödeme kanıtı
- Merchant zincirden token, miktar, gönderici, alıcı ve confirmation doğrular
- Aynı payment proof ikinci kez kullanılamaz

Bu model testnet içindir; ana ağ üretim tasarımına geçmeden önce non-custodial delegation veya batch settlement değerlendirilir.

### 12.3 Session wallet güvenliği

Zorunlu önlemler:

- Ham private key `.env`, log veya SQLite’ta tutulmaz.
- Anahtar envelope encryption ile saklanır.
- Testnet dışı kullanım feature flag ile engellenir.
- Kullanıcı başına maksimum bakiye limiti vardır.
- Görev başına ve günlük harcama limiti vardır.
- Para yatırma ve kalan bakiyeyi çekme akışı vardır.
- Anahtar rotasyonu ve acil dondurma vardır.
- Tüm imzalama olayları audit log’a yazılır.
- Session wallet başına nonce manager/transaction queue bulunur.

### 12.4 Ölçek sınırları

İlk canlı pilotta:

```text
Maksimum ücretli aday merchant: 3
Maksimum pazarlık çağrısı: 1
Maksimum rezervasyon çağrısı: 1
Görev başına maksimum mikro ödeme: 8
Görev başına araştırma bütçesi: 0.010000 USDC
İstek başına maksimum: 0.002000 USDC
```

Aday daraltma sırası:

```text
kategori
→ PostGIS yakınlık
→ gerçek yürüme rotası
→ mağaza açık mı
→ kaba stok sinyali
→ kullanıcı tercihleri
→ en fazla 3 ücretli teklif
```

### 12.5 Çağrı birleştirme

Her SKU için ayrı sorgu yerine merchant başına toplu endpoint kullanılır:

```text
POST /merchant/:id/quote-basket
```

Bu çağrı:

- Sepet stok uygunluğu
- Temel fiyat
- Geçerli kampanyalar
- Hazırlama süresi
- Rezervasyon uygunluğu
- İmzalı nihai teklif

sonucunu tek ücretli cevapta döndürebilir.

---

## 13. Düzeltilmiş Sipariş ve Escrow Durum Makinesi

Önceki plandaki “önce fund, sonra merchant accept” çelişkisi kaldırılmıştır.

### 13.1 Ana akış

```text
quoted
→ user_selected
→ merchant_pending
→ merchant_confirmed
→ awaiting_funding
→ paid_in_escrow
→ preparing
→ ready
→ completed
```

### 13.2 Yan akışlar

```text
merchant_pending
→ merchant_rejected
→ expired

merchant_pending
→ merchant_accept_timeout
→ expired

merchant_confirmed
→ funding_timeout
→ cancelled + reservation_release

paid_in_escrow
→ preparation_timeout
→ refunded

paid_in_escrow | preparing | ready
→ disputed
→ completed | partially_refunded | refunded
```

### 13.3 Doğru kullanıcı akışı

1. Kullanıcı bir seçeneği seçer.
2. İlgili merchant’lara kabul isteği gönderilir.
3. Merchant 60–120 saniye içinde kabul veya ret verir.
4. Tüm zorunlu merchant’lar kabul ederse kullanıcı fonlama ekranına geçer.
5. Kullanıcı `approve` ve `fund` işlemlerini yapar.
6. Bridge tx event’lerini zincirden doğrular.
7. Escrow fonlandığında merchant hazırlamaya başlayabilir.

### 13.4 Çoklu MetaMask onayı

İlk sürüm dükkan başına approve/fund işlemini destekleyebilir; ancak UX’te adım adım fonlama sihirbazı bulunur.

Sonraki optimizasyonlar:

- Tek allowance ve çoklu fund
- `fundBatch`
- Permit tabanlı fonlama
- Smart account ile transaction batching

Kısmi fonlama halinde:

- Fonlanan escrow’lar açıkça gösterilir.
- Fonlanmayan zorunlu mağaza varsa otomatik rollback/refund politikası uygulanır.
- Kullanıcı kaldığı yerden devam edebilir.

---

## 14. Ödeme Defteri ve Zincir Mutabakatı

### 14.1 Append-only payment ledger

```text
payment_events
- id
- accountId
- merchantId
- taskId
- orderId
- escrowId
- eventType
- direction
- amountMicroUsdc
- status
- chainId
- tokenAddress
- fromAddress
- toAddress
- txHash
- blockNumber
- transactionIndex
- logIndex
- confirmations
- idempotencyKey
- relatedPaymentEventId
- failureReason
- createdAt
- confirmedAt
```

Benzersizlik:

```text
chainId + txHash + logIndex
```

### 14.2 Source of truth

- Zincir, on-chain transfer ve escrow durumunun source of truth’udur.
- PostgreSQL sorgulama ve kullanıcı görünümü için indekslenmiş kopyadır.
- Worker düzenli olarak zincir ile DB’yi karşılaştırır.

### 14.3 Confirmation politikası

Ağ için gereken minimum confirmation sayısı env/config ile belirlenir. İşlem önce `pending`, sonra `confirmed` olur. Reorg veya kaybolan transaction durumunda reconciliation worker kaydı düzeltir.

---

## 15. Kullanıcı Paneli

### Ana panel

- Aktif agent görevi
- Devam eden siparişler
- Escrow’da bekleyen ödemeler
- Son konuşmalar
- Son promptlar
- Araştırma bütçesi ve harcaması
- Favori mağazalar
- Tekrar sipariş seçenekleri

### Konuşma geçmişi

Mesaj türleri:

```text
user
assistant
system_event
tool_event
merchant_quote
payment_event
order_event
```

### Ödeme geçmişi

- Araştırma mikro ödemeleri
- Escrow fonlamaları
- Release
- Refund
- Session wallet yatırma/çekme
- Explorer bağlantıları

### Agent hafızası

- Hatırlanan tercihler
- Episodik kayıtlar
- Kaynak konuşma
- Güven skoru
- Düzenle/sil
- Kişiselleştirme izni

### Konum ayarları

- Maksimum yürüme mesafesi
- Maksimum yürüme süresi
- Favori başlangıç noktası
- Her görevde konumu yeniden sor

### Destek

- Eksik ürün
- Yanlış ürün
- Kalite sorunu
- Ödeme sorunu
- Kısmi iade talebi
- Fotoğraf ekleme

---

## 16. Satıcı Paneli

### Genel bakış

- Kabul bekleyen siparişler
- Hazırlananlar
- Teslime hazırlar
- Günlük tamamlanan sipariş
- Bekleyen escrow
- Serbest bırakılan gelir
- Mikro sorgu geliri
- Düşük stok
- Aktif kampanya

### Sipariş panosu

```text
Yeni
→ Kabul Edildi
→ Fon Bekliyor
→ Escrow Fonlandı
→ Hazırlanıyor
→ Hazır
→ Tamamlandı
```

### Ürünler

- Canonical SKU eşleme
- Fiyat
- Minimum fiyat
- Birim
- Görsel
- Aktif/pasif

### Stok

- Fiziksel
- Rezerve
- Satılabilir
- Düşük stok
- Hareket geçmişi

### Kampanyalar

- Kampanya oluştur
- Başlat/durdur
- Tarih ve saat
- Ürün/kategori seç
- Kullanım limiti
- Müşteri uygunluk kuralı
- Kampanya performansı

### Agent ayarları

- Pazarlığa açık mı
- Maksimum indirim
- Minimum fiyat/marj sınırı
- Otomatik rezervasyon
- Rezervasyon süresi
- Düşük stokta teklif verme
- Çalışma saatleri
- Ortalama hazırlama süresi

---

## 17. Veri Modeli

### Hesap ve auth

```text
accounts
wallets
sessions
user_profiles
location_preferences
```

### Agent ve konuşma

```text
agents
agent_profiles
agent_memories
conversations
conversation_messages
saved_prompts
shopping_templates
```

### Merchant

```text
merchant_organizations
merchant_members
merchant_wallets
merchant_settings
merchant_locations
merchant_hours
```

### Katalog, stok ve kampanya

```text
products
merchant_products
warehouses
inventory
inventory_movements
campaigns
campaign_rules
campaign_usage
```

### Sipariş ve ödeme

```text
tasks
task_orders
order_items
merchant_acceptances
reservations
quotes_seen
escrows
payment_events
receipts
support_tickets
```

### Operasyon

```text
audit_logs
outbox_events
job_runs
chain_cursors
```

Tüm tablolarda uygun foreign key, unique constraint, version ve audit alanları bulunur.

---

## 18. Uygulama Fazları

### Faz 0 — Mimari, state machine ve threat model

- [ ] Sipariş state machine’ini yukarıdaki sıraya göre kesinleştir.
- [ ] Merchant kabulü, reservation ve funding timeout kurallarını yaz.
- [ ] Session wallet threat model ve testnet-only sınırını dokümante et.
- [ ] x402 ödeme payload ve replay korumasını kesinleştir.
- [ ] PostgreSQL şema sahipliğini ve servis sınırlarını belirle.
- [ ] Chain confirmation ve reconciliation politikasını belirle.

### Faz A — PostgreSQL, PostGIS, pgvector ve Redis temeli

- [ ] Migration altyapısı kur.
- [ ] SQLite verilerini seed formatına dönüştür.
- [ ] PostgreSQL schema ve constraint’leri oluştur.
- [ ] PostGIS ve pgvector extension’larını etkinleştir.
- [ ] Redis bağlantısı, task state ve transaction queue altyapısını kur.
- [ ] Backup ve restore prosedürü yaz.

### Faz B — Arc zinciri ve kontratlar

- [ ] Arc testnet parametrelerini güncel kaynaktan doğrula.
- [ ] OrderEscrow, MerchantDirectory ve OrderReceipt deploy et.
- [ ] `ArcProvider` viem implementasyonunu tamamla.
- [ ] Merchant chain client gerçek tx’leri uygulasın.
- [ ] Contract testlerini Foundry ile çalıştır.
- [ ] Deploy adreslerini versioned deployment dosyasına yaz.

### Faz C — Cüzdan girişi ve hesap sistemi

- [ ] wagmi + viem cüzdan bağlantısı.
- [ ] Nonce ve imza doğrulama uçları.
- [ ] Hash’li session storage ve güvenli cookie.
- [ ] İlk girişte account + wallet + agent oluşturma.
- [ ] Customer/Merchant mode geçişi.
- [ ] Audit log.

### Faz D — Merchant organization ve onboarding

- [ ] Merchant organization oluşturma.
- [ ] Owner membership.
- [ ] Merchant payout wallet doğrulama.
- [ ] Mağaza profili, adres, PostGIS konumu ve çalışma saatleri.
- [ ] MerchantDirectory kayıt bağlantısı.
- [ ] Merchant agent kimliği ve signer ilişkisi.

### Faz E — Ürün, depo ve stok paneli

- [ ] Canonical SKU eşlemeli ürün CRUD.
- [ ] Fiyat/minimum fiyat ve bigint doğrulamaları.
- [ ] Warehouse ve inventory tabloları.
- [ ] Atomik stok rezervasyonu.
- [ ] Inventory movements.
- [ ] Düşük stok uyarıları.
- [ ] CSV içe aktarma.

### Faz F — Kampanya ve kişisel teklif motoru

- [ ] Kampanya CRUD.
- [ ] Deterministik rule evaluator.
- [ ] Sadakat, ilk sipariş, zaman ve stok kuralları.
- [ ] Kullanım limitleri ve atomik campaign usage.
- [ ] Teklifte campaign/inventory/price version alanları.
- [ ] Kişiselleştirmenin yalnızca indirim ve fayda üretmesini zorlayan testler.

### Faz G — Gerçek LLM ve agent hafızası

- [ ] Gerçek provider bağlantısı.
- [ ] Context Builder.
- [ ] Tool registry ve allowlist.
- [ ] ShoppingPlan zod şeması.
- [ ] Structured preference storage.
- [ ] Episodic memory extraction.
- [ ] pgvector retrieval.
- [ ] Kullanıcı onaylı memory write.
- [ ] Hafıza düzenleme/silme ekranı.
- [ ] Prompt injection ve tool authorization testleri.

### Faz H — PostGIS ve yaya rota

- [ ] Kullanıcı geolocation izni ve manuel fallback.
- [ ] PostGIS ön filtre sorguları.
- [ ] RouteProvider adaptörü.
- [ ] Gerçek walking distance/duration.
- [ ] 1 km/15 dakika varsayılan filtre.
- [ ] En fazla 3 mağazalı gel-al rota optimizasyonu.
- [ ] Konum gizliliği ve retention kuralları.

### Faz I — Merchant kabulü ve escrow fonlama

- [ ] `merchant_pending` ve `merchant_confirmed` durumları.
- [ ] Kabul/reddet/timeout ekranları.
- [ ] Kabul sonrası stok rezervasyonu.
- [ ] `awaiting_funding` durumu.
- [ ] Frontend approve + fund sihirbazı.
- [ ] Kısmi fonlama ve devam etme.
- [ ] Funding timeout ve rezervasyon release.

### Faz J — Gerçek ücretli sorgular

- [ ] 402 payment requirements response.
- [ ] ArcPaymentProvider.
- [ ] Session wallet deposit/withdraw.
- [ ] Encrypted key management.
- [ ] Wallet başına nonce queue.
- [ ] Transfer log doğrulama.
- [ ] Replay ve idempotency koruması.
- [ ] `quote-basket` ücretli toplu endpoint’i.
- [ ] Aday merchant ve mikro ödeme limitleri.

### Faz K — Geçmiş, finans ve destek ekranları

- [ ] Conversation timeline.
- [ ] Sipariş geçmişi.
- [ ] Payment ledger ekranı.
- [ ] Explorer linkleri.
- [ ] Agent memory ekranı.
- [ ] Saved prompts ve shopping templates.
- [ ] Support ticket ve fotoğraf yükleme.
- [ ] Satıcı gelir ekranı.

### Faz L — Worker, mutabakat ve bildirim

- [ ] Chain event indexer.
- [ ] Reconciliation worker.
- [ ] Reservation/offer/campaign expiration.
- [ ] Web Push ve sesli merchant bildirimi.
- [ ] Outbox pattern.
- [ ] Retry, dead-letter ve job gözlemleme.

### Faz M — Canlıya alma ve hardening

- [ ] Web → Vercel veya aynı VPS.
- [ ] API/runtime/merchant/worker → process manager veya container.
- [ ] Managed PostgreSQL önerilir.
- [ ] Redis deployment.
- [ ] HTTPS, CORS ve CSP.
- [ ] Secret manager.
- [ ] RPC fallback ve rate limiting.
- [ ] Monitoring, structured logging ve alerting.
- [ ] Backup restore testi.
- [ ] Gerçek testnet uçtan uca senaryoları.

---

## 19. Uçtan Uca Kabul Senaryosu

1. Kullanıcı MetaMask ile Arc testnet’e bağlanır.
2. Mesaj imzalayarak giriş yapar.
3. İlk girişte hesap, profil ve kişisel agent oluşur.
4. Kullanıcı konum izni verir ve maksimum yürüme mesafesini 1 km seçer.
5. “4 kişilik köfte yapacağım, uygun fiyatlı ama kıyma kaliteli olsun” yazar.
6. LLM isteği canonical SKU ve tercih ağırlıklarına dönüştürür.
7. Agent episodik hafızadan kullanıcının daha önce Ali Kasap’ı beğendiğini bulur.
8. PostGIS aday mağazaları daraltır; rota servisi gerçek yaya mesafelerini hesaplar.
9. En fazla 3 merchant’tan ücretli `quote-basket` alınır.
10. Merchant agent’lar stok, kampanya ve kişisel uygunluk kurallarını deterministik hesaplar.
11. Kullanıcıya En Ucuz, En Kaliteli ve En Uygun Yürüme Rotası seçenekleri gösterilir.
12. Kullanıcı seçer; merchant’lar kabul penceresinde onay verir.
13. Kabul sonrası kullanıcı dükkan başına escrow fonlar.
14. Satıcı hazırlamaya geçer ve hazır işaretler.
15. Kullanıcı yürüyerek mağazalara gider; teslim kodları doğrulanır.
16. Escrow’lar zincir üstünde serbest bırakılır.
17. Konuşma, agent memory adayları, ödeme olayları, rota ve sipariş makbuzu hesaba kaydedilir.
18. Kullanıcı yeni hafıza adaylarını görebilir, onaylayabilir veya silebilir.

---

## 20. Test Stratejisi

### Unit

- Kampanya evaluator
- Stok rezervasyon invariant’ları
- Fiyat bigint hesapları
- Memory candidate rules
- Konum filtreleri
- Payment budget
- Idempotency

### Integration

- PostgreSQL transaction ve row locking
- PostGIS yakınlık sorgusu
- pgvector memory retrieval
- RouteProvider
- Arc transfer log doğrulama
- Session wallet nonce queue
- Merchant acceptance/funding timeout

### Contract

- Happy path
- Yanlış teslim kodu
- Double fund
- Timeout refund
- Dispute ve partial refund gerekiyorsa kontrat genişletmesi
- Reentrancy
- Yetkisiz merchant state update

### Agent güvenliği

- LLM fiyat uyduramıyor
- LLM tool allowlist dışına çıkamıyor
- Merchant ürün açıklaması prompt injection yapamıyor
- Kullanıcı onayı olmadan kalıcı hassas hafıza yazılmıyor
- Kişisel kampanya temel fiyatı yükseltemiyor

### E2E

- Yeni kullanıcı giriş ve agent oluşturma
- Satıcı onboarding
- Ürün ve stok ekleme
- Kampanya oluşturma
- Yaya keşfi
- Gerçek ücretli teklif
- Merchant accept
- Escrow fund
- Teslim kodu ve release
- Payment history ve memory görünümü

---

## 21. Kritik Riskler ve Önlemler

| Risk | Önlem |
|---|---|
| LLM yanlış ürün planı çıkarır | Zod şeması, canonical SKU allowlist, confidence ve kullanıcıya düzenleme adımı |
| LLM fiyat/stok uydurur | Bu alanlar yalnızca tool sonucundan gelir; response validator ve test |
| Episodik hafıza yanlış genelleme yapar | Confidence, kaynak bağlantısı, expiry ve kullanıcı onayı |
| Satıcı temel fiyatı kullanıcıya göre değiştirir | Temel fiyat versiyonlu ürün kaydından gelir; kişisel kural yalnızca indirim uygulayabilir |
| Stok yarış koşulu | PostgreSQL transaction, row lock, version kontrolü ve atomik rezervasyon |
| Kampanya kullanım limiti aşılır | Atomik campaign usage kaydı ve unique constraint |
| Gerçek rota servisi yavaş veya ulaşılamaz | Cache, timeout, ikinci sağlayıcı ve Haversine fallback etiketi |
| Kullanıcı konumunu paylaşmak istemez | Manuel konum, yaklaşık konum ve kalıcı saklamama |
| Merchant kabul etmeden para kilitlenir | State machine fonlamayı yalnızca `merchant_confirmed` sonrası açar |
| Approve verilir, fund tamamlanmaz | Fonlama sihirbazı, `awaiting_funding`, timeout ve rezervasyon release |
| Çoklu MetaMask onayı UX’i bozar | İlk sürüm adım adım sihirbaz; sonraki sürüm permit/batch fund |
| Session wallet anahtarı ele geçirilir | Testnet-only, şifreli key store, düşük bakiye, limit, freeze ve audit |
| Paralel transfer nonce çakışması | Wallet başına tek transaction queue ve nonce manager |
| Tx hash yanlış veya tekrar kullanılır | Transfer log, sender/receiver/amount doğrulama, confirmation ve replay tablosu |
| DB ile zincir ayrışır | Chain event indexer ve periyodik reconciliation |
| PostgreSQL kaybı | Managed DB, otomatik backup ve restore tatbikatı |
| Mikro ödeme sayısı artar | En fazla 3 merchant, `quote-basket`, görev başı 8 işlem limiti |
| Satıcı paneli karmaşıklaşır | Basit varsayılan görünüm; gelişmiş ayarlar ayrı bölüm |
| Kontrat dispute modeli yetersiz kalır | Support ticket, manuel arbiter; kısmi iade ihtiyacı kontrat revizyonunda ele alınır |

---

## 22. Başarı Kriterleri

Bu plan tamamlandığında:

- Kullanıcı gerçek cüzdanla güvenli biçimde giriş yapar.
- Her kullanıcıya ait kalıcı agent profili ve episodik hafıza bulunur.
- Gerçek LLM, kullanıcı tercihlerini ve ilgili hafızaları kullanarak alışveriş planı çıkarır.
- LLM kritik ticari rakamları uyduramaz.
- Satıcı kendi organizasyonunu, ürünlerini, stoklarını ve kampanyalarını yönetir.
- Kişiye özel teklifler şeffaf ve deterministik kurallarla üretilir.
- PostGIS ve rota sağlayıcıyla gerçek yürüme mesafesi kullanılır.
- En fazla üç mağazalı gel-al rota seçeneği oluşturulur.
- Her ücretli merchant sorgusu gerçek Arc testnet USDC ödeme kanıtına bağlanır.
- Satıcı kabul etmeden escrow fonlanmaz.
- Kullanıcı gerçek cüzdanından escrow fonlar.
- Teslim kodu doğrulamasıyla ödeme zincir üstünde serbest bırakılır.
- Konuşma, sipariş, ödeme, kampanya ve stok hareketleri kalıcı ve denetlenebilir biçimde kaydedilir.
- Kullanıcı agent hafızasını görebilir, düzeltebilir ve silebilir.

---

## 23. Sonraki Sürüm İçin Bekleyenler

Bu canlı sürümün ardından ayrı planlanacak konular:

- Kurye ve teslimat ağı
- Çoklu şube ve gelişmiş satıcı rolleri
- Batch settlement veya ödeme kanalları
- Şifreli Private Agent Memory Vault
- On-chain Merkle root
- ZK sadakat/kampanya/bütçe kanıtları
- TEE içinde özel agent çalıştırma
- Smart account ve toplu escrow fonlama
- Ana ağ güvenlik denetimi ve non-custodial session payment modeli

