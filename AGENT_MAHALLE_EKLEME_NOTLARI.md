# Agent Mahalle — Yeni Özellikler ve Genişleme Notları

> Bu doküman, mevcut **Agent Mahalle** proje brief’inin üzerine eklenecek yeni ürün, mimari ve teknoloji kararlarını toplar. Amaç; projeyi cüzdan tabanlı, kişiselleştirilebilir, çok rollü ve gizlilik odaklı bir yerel ticaret platformuna dönüştürmektir.

---

## 1. Yeni Ürün Vizyonu

Mevcut proje; kullanıcı isteğini SKU listesine çeviren, çevredeki esnaf agent’larından x402 tarzı ücretli teklifler toplayan, kullanıcı onayından sonra escrow fonlayan ve teslim kodu ile ödeme serbest bırakan bir sistemdir.

Yeni hedef, bu yapıyı aşağıdaki özelliklerle genişletmektir:

- Cüzdan tabanlı kalıcı kullanıcı hesapları
- Kullanıcıya özel AI agent ve hafıza
- Konuşma ve prompt geçmişi
- Ödeme, escrow, iade ve araştırma harcaması geçmişi
- Satıcı organizasyonları ve satıcı hesapları
- Ürün, stok, depo, kampanya ve sipariş yönetimi
- Her kullanıcı ve satıcı için mantıksal agent kimliği
- Konuma göre yürüme, gel-al ve kurye seçenekleri
- Güncel stok ve kampanyalara göre kişiye özel teklifler
- Şifreli agent hafızası
- On-chain bütünlük kaydı
- ZK tabanlı sadakat, kampanya ve bütçe kanıtları

Projenin yeni değer önerisi:

> “Ne istediğini söyle; çevrendeki gerçek stoklardan sana en uygun sepeti bulalım, tercihlerini hatırlayalım ve ödemen teslimata kadar güvende kalsın.”

---

## 2. Hesap ve Kimlik Sistemi

### 2.1 Cüzdan, Hesabın Kendisi Değil Kimlik Yöntemidir

Cüzdan adresi tek başına giriş için yeterli sayılmamalıdır. Giriş akışı imza doğrulamasıyla yapılmalıdır.

Önerilen akış:

1. Kullanıcı cüzdanını bağlar.
2. Backend tek kullanımlık bir nonce üretir.
3. Kullanıcı nonce içeren mesajı imzalar.
4. Backend imzayı doğrular.
5. Kullanıcı için oturum açılır.
6. Cüzdan ilk kez görülüyorsa yeni hesap oluşturulur.

Önerilen temel yapı:

```text
Account
├── Wallets
├── User Profile
├── Merchant Memberships
├── Preferences
├── Conversations
├── Saved Prompts
└── Payment History
```

Bir hesap aynı anda hem müşteri hem satıcı olabilir.

Arayüzde:

```text
Müşteri Modu | Satıcı Modu
```

geçişi bulunabilir.

### 2.2 Kullanıcı Hesabı

Kullanıcı hesabı aşağıdaki alanları içermelidir:

- Profil bilgileri
- Bağlı cüzdanlar
- Tercihler
- Konuşma geçmişi
- Prompt geçmişi
- Kaydedilmiş promptlar
- Alışveriş şablonları
- Sipariş geçmişi
- Araştırma ödemeleri
- Ana alışveriş ödemeleri
- Escrow hareketleri
- İadeler
- Favori satıcılar
- Favori ürünler
- Agent hafızası

### 2.3 Satıcı Hesabı

Satıcı tek bir cüzdan adresi olarak değil, bir organizasyon olarak modellenmelidir.

```text
Merchant Organization
├── Store Profile
├── Members
├── Wallets
├── Products
├── Inventory
├── Warehouses
├── Campaigns
├── Orders
├── Payments
├── Delivery Settings
└── Agent Settings
```

İlk MVP’de yalnızca `Owner` rolü yeterli olabilir. Veri modeli ileride şu rolleri desteklemelidir:

- Owner
- Manager
- Inventory Manager
- Order Operator
- Finance Viewer

---

## 3. Kullanıcı Paneli

### 3.1 Kullanıcı Ana Paneli

Kullanıcı ana ekranında aşağıdaki bilgiler gösterilmelidir:

- Devam eden siparişler
- Escrow’da bekleyen ödemeler
- Son konuşmalar
- Son promptlar
- Kaydedilmiş alışveriş şablonları
- Toplam araştırma harcaması
- Toplam alışveriş harcaması
- İade edilen tutarlar
- Favori satıcılar
- Tekrar sipariş verilebilecek sepetler

### 3.2 Konuşma Geçmişi

Her konuşma ayrı bir kayıt olarak tutulmalıdır.

```text
Conversation
- id
- accountId
- walletAddress
- title
- status
- createdAt
- updatedAt
```

Mesajlar ayrı tabloda bulunmalıdır:

```text
Message
- id
- conversationId
- role
- content
- messageType
- createdAt
```

Örnek `messageType` değerleri:

```text
user
assistant
system_event
merchant_quote
payment_event
order_event
```

Sadece doğal dil mesajları değil, aşağıdaki olaylar da konuşma zaman çizelgesine işlenebilir:

- Satıcı keşfi
- Stok sorgusu
- Teklif alınması
- Mikro ödeme
- Pazarlık
- Rezervasyon
- Escrow fonlama
- Sipariş hazırlanması
- Teslim doğrulaması
- İade

LLM’in gizli düşünme süreci saklanmamalıdır. Yalnızca kullanıcıya gösterilen mesajlar, agent aksiyonları ve doğrulanabilir sistem olayları tutulmalıdır.

### 3.3 Prompt Sistemi

Üç prompt türü desteklenmelidir:

#### Geçmiş Promptlar

Kullanıcının daha önce yazdığı istekler.

#### Kaydedilmiş Promptlar

Örnek:

```text
Haftalık kahvaltı alışverişimi hazırla.
4 kişilik köfte malzemelerini bul.
En yakın marketlerden temizlik ürünleri topla.
```

#### Alışveriş Şablonları

Daha yapısal ve tekrar kullanılabilir biçim:

```text
Şablon: Haftalık Kahvaltı
Kişi sayısı: 3
Tercih: Organik ürün
Maksimum araştırma bütçesi: 0.006000 USDC
Teslim biçimi: Gel-al
```

### 3.4 Kullanıcı Ödeme Geçmişi

Ödeme geçmişi üç ana gruba ayrılmalıdır:

1. Agent araştırma ödemeleri
2. Ana alışveriş ve escrow ödemeleri
3. İade ve serbest bırakma işlemleri

Her ödeme kaydında şunlar bulunmalıdır:

- İşlem türü
- Tutar
- Yön: debit / credit
- Satıcı
- Sipariş
- Görev
- Durum
- Tarih
- Ağ
- Transaction hash
- Idempotency key
- Escrow ID
- İade veya release nedeni

Örnek görünüm:

```text
Araştırma ödemeleri
- Ali Kasap teklif sorgusu        -0.000500 USDC
- Zeynep Manav stok sorgusu       -0.000300 USDC
- Cem Fırın rezervasyon           -0.001000 USDC

Sipariş ödemeleri
- Ali Kasap escrow               -12.500000 USDC
- Zeynep Manav escrow             -4.350000 USDC

İade
- Mini Market stok hatası         +2.100000 USDC
```

---

## 4. Satıcı Paneli

### 4.1 Genel Bakış

Satıcı ana panelinde:

- Bugünkü sipariş sayısı
- Hazırlanmayı bekleyen siparişler
- Teslime hazır siparişler
- Escrow’da bekleyen toplam tutar
- Serbest bırakılan ödemeler
- İadeler
- Düşük stoklu ürünler
- Aktif kampanyalar
- Son agent istekleri
- Teklif dönüşüm oranı
- Mikro ödeme gelirleri

bulunmalıdır.

### 4.2 Sipariş Yönetimi

Sipariş panosu mevcut state machine ile uyumlu çalışmalıdır:

```text
quoted
→ reserved
→ approved
→ paid_in_escrow
→ preparing
→ ready
→ completed
```

Sipariş kartında:

- Kısaltılmış müşteri cüzdanı
- Ürünler
- Toplam tutar
- Sipariş zamanı
- Hazırlama süresi
- Escrow durumu
- Teslim kodu alanı
- İptal/iade durumu

bulunmalıdır.

### 4.3 Ürün Kataloğu

Her satıcı ürünü aşağıdaki alanları içermelidir:

```text
SKU
Ürün adı
Kategori
Birim
Satış fiyatı
Maliyet
Mevcut stok
Rezerve stok
Minimum stok seviyesi
Aktif/pasif durumu
Kalite etiketi
Görsel
```

Satıcı ürünü kanonik SKU ile eşlenmelidir.

Örnek:

```text
Kanonik SKU: BEEF_GROUND_1KG
Satıcı ürünü: Günlük Orta Yağlı Dana Kıyma
Fiyat: 9.500000 USDC
Stok: 12
```

LLM yalnızca kanonik ihtiyacı çıkarmalı; gerçek ürün, fiyat ve stok satıcı veri tabanından gelmelidir.

### 4.4 Depo ve Stok Yönetimi

En az üç stok değeri tutulmalıdır:

```text
physicalStock
reservedStock
availableStock
```

Rezervasyonda:

```text
availableStock -= quantity
reservedStock += quantity
```

Sipariş tamamlandığında:

```text
reservedStock -= quantity
physicalStock -= quantity
```

Sipariş iptal veya timeout olduğunda:

```text
reservedStock -= quantity
availableStock += quantity
```

Satıcı panelinde:

- Düşük stok uyarıları
- Stok hareketleri
- Manuel stok düzeltmesi
- Fire/kayıp kaydı
- Ürün giriş geçmişi
- Rezervasyon geçmişi
- Toplu CSV içe aktarma

bulunmalıdır.

### 4.5 Kampanya Yönetimi

Kampanyalar LLM tarafından doğrudan fiyat uydurularak uygulanmamalıdır. Deterministik bir kampanya kural motoru kullanılmalıdır.

Desteklenecek kampanya türleri:

- Yüzde indirim
- Sabit indirim
- İkinci ürüne indirim
- Paket ürün
- Minimum sepet indirimi
- Saat bazlı indirim
- Stok eritme kampanyası
- Sadık müşteri kampanyası
- İlk sipariş kampanyası
- Ücretsiz veya indirimli teslimat

Örnek kampanya:

```text
Kampanya adı: Akşam Ekmek Kampanyası
Ürün: SOMUN_EKMEK
Kural: İkinci ürüne %20 indirim
Saat: 18.00–21.00
Toplam kullanım limiti: 50
Müşteri başı limit: 2
```

Teklif sırasında kampanya motoru:

```text
Temel fiyat
→ Geçerli kampanyalar
→ Stok ve kullanım limitleri
→ Nihai fiyat
→ EIP-712 imzalı teklif
```

şeklinde çalışmalıdır.

Teklifte:

```text
campaignId
campaignVersion
originalAmount
baseAmount
discountAmount
finalAmount
inventoryVersion
nonce
validUntil
merchantId
customerWallet
```

alanları bulunmalıdır.

### 4.6 Satıcı Agent Ayarları

Satıcı agent’ı serbestçe karar vermemeli; satıcının belirlediği sınırlar içinde çalışmalıdır.

Örnek ayarlar:

```text
Pazarlığa açık: Evet
Maksimum indirim: %5
Minimum kâr marjı: %12
Otomatik rezervasyon: Evet
Rezervasyon süresi: 10 dakika
Maksimum günlük rezervasyon: 100
Düşük stokta teklif verme: Hayır
Hazırlama süresi: 15 dakika
Mağaza çalışma saatleri: 08.00–22.00
```

Agent şu alanları kontrol etmelidir:

```text
merchantSettings.negotiationEnabled
merchantSettings.maxDiscountBps
product.minimumPrice
campaignRules
availableStock
workingHours
```

### 4.7 Satıcı Finans Alanı

Satıcının finans ekranı şu bölümlere ayrılmalıdır:

- Escrow’da bekleyen tutarlar
- Tamamlanan satışlar
- İade edilen siparişler
- Agent sorgu gelirleri
- Teklif sorgusu geliri
- Stok sorgusu geliri
- Pazarlık geliri
- Rezervasyon geliri

Örnek:

```text
Ürün satış geliri          842.400000 USDC
Teklif sorgusu geliri        1.240000 USDC
Stok sorgusu geliri          0.680000 USDC
Pazarlık geliri              0.460000 USDC
Rezervasyon geliri           0.820000 USDC
İade edilen                 -8.400000 USDC
```

---

## 5. Agent Mimarisi

### 5.1 Agent Türleri

```text
Marketplace Coordinator
├── User Agent
├── Merchant Agent
└── Courier Agent / Delivery Service
```

#### User Agent

Kullanıcıyı temsil eder.

Bilir:

- Kullanıcı tercihleri
- Önceki siparişler
- Favori satıcılar
- Favori ürünler
- Beslenme tercihleri
- Maksimum bütçe
- Yürüme toleransı
- Teslimat tercihleri
- Reddedilen teklifler
- Beğenilen teklifler

Ana alışveriş ödemesi kullanıcı onayı olmadan yapılmamalıdır.

#### Merchant Agent

Satıcının iş kurallarını uygular.

Bilir:

- Güncel stok
- Ürün fiyatları
- Kampanyalar
- Minimum satış fiyatı
- Pazarlık sınırları
- Hazırlama süresi
- Çalışma saatleri
- Rezervasyon politikası
- Teslimat bölgesi
- Kurye durumu

#### Marketplace Coordinator

Görevleri:

- Kullanıcı isteğini anlamak
- SKU planı oluşturmak
- Uygun satıcıları bulmak
- Ücretli sorguları yönetmek
- Mikro ödeme bütçesini korumak
- Teklifleri karşılaştırmak
- Rota ve teslimat seçenekleri üretmek
- Kullanıcıya seçenek sunmak
- Escrow fonlama akışını başlatmak

### 5.2 Her Kullanıcı İçin Ayrı LLM Değil Mantıksal Agent

Her kullanıcı için ayrı bir model süreci çalıştırılmamalıdır.

Doğru yaklaşım:

```text
Ortak LLM altyapısı
+
Her üyeye ait mantıksal agent kimliği
+
Agent profili
+
Hafıza
+
Yetkiler
+
Tool erişimleri
```

100.000 kullanıcı varsa 100.000 sürekli çalışan model gerekmez.

Her çağrıda:

```text
AgentRuntime.start(agentId)
→ Profil yüklenir
→ İlgili hafıza yüklenir
→ Konum alınır
→ Güncel stok/kampanya sorgulanır
→ LLM bağlamı oluşturulur
→ Agent araçları çalıştırır
```

Agent runtime işlem sonunda kapatılabilir; kimlik ve hafıza veri tabanında kalır.

---

## 6. Agent Hafızası

Hafıza tek bir uzun metin olarak tutulmamalıdır.

### 6.1 Çalışma Hafızası

Sadece aktif görev için kullanılır.

```json
{
  "taskId": "task_123",
  "request": "4 kişilik köfte malzemesi",
  "selectedMode": "walking",
  "location": {
    "lat": 39.9208,
    "lng": 32.8541
  },
  "discoveredMerchants": [],
  "quotes": [],
  "researchSpentMicroUsdc": 2300
}
```

Redis gibi geçici bir katmanda tutulabilir.

### 6.2 Yapısal Profil Hafızası

Kesin ve düzenlenebilir bilgiler PostgreSQL’de ayrı alanlar olarak tutulmalıdır.

Örnek:

- Maksimum yürüme mesafesi: 1 km
- Fiyat hassasiyeti: yüksek
- Organik ürün tercihi: açık
- Alerji bilgisi
- Tercih edilen satıcı
- Kurye bütçesi

Bunlar yalnızca embedding içinde tutulmamalıdır.

### 6.3 Episodik Hafıza

Önceki alışverişlerin özetleri:

```text
12 Temmuz alışverişinde kullanıcı Ali Kasap’ın kıymasını seçti.
Daha ucuz olan Can Kasap seçeneğini kalite puanı nedeniyle reddetti.
Kullanıcı alışveriş sonunda 5 yıldız verdi.
```

Bu kayıtlar hem metin hem embedding olarak saklanabilir.

### 6.4 Finansal ve Operasyonel Kayıtlar

Aşağıdaki veriler AI hafızası değil, kesin kayıt olarak tutulmalıdır:

```text
orders
payments
escrows
quotes
receipts
inventory_movements
```

AI bu bilgilere tool çağrılarıyla erişmelidir. Finansal sorular vektör aramasıyla cevaplanmamalıdır.

### 6.5 Hafıza Yazma Politikası

Her kullanıcı cümlesi otomatik kalıcı hafızaya dönüşmemelidir.

Akış:

```text
Konuşma tamamlandı
→ Memory Extractor aday hafıza üretir
→ Hafıza türü belirlenir
→ Güven skoru hesaplanır
→ Gerekirse kullanıcı onayı alınır
→ Süreli veya kalıcı kayıt oluşturulur
```

Önerilen tablo:

```text
agent_memories
- id
- agentId
- type
- content
- structuredKey
- structuredValue
- confidence
- sourceConversationId
- sourceMessageId
- expiresAt
- userConfirmed
- createdAt
```

Kullanıcı panelinde:

```text
Agentımın Benim Hakkımda Bildikleri
```

alanı bulunmalıdır.

Kullanıcı:

- Hafızayı görebilmeli
- Düzeltebilmeli
- Silebilmeli
- Geçici yapabilmeli
- Kişiselleştirmeyi kapatabilmeli
- Belirli hafıza kategorilerini kapatabilmeli

---

## 7. AI Kişiselleştirme Modeli

İlk aşamada kullanıcı başına fine-tune edilmiş model gerekli değildir.

Önerilen yöntem:

```text
Ortak temel model
+
Kullanıcı profili
+
İlgili hafıza
+
Canlı pazar verisi
+
Tool çağrıları
```

Her istek için `Context Builder` çalışmalıdır:

```text
System Policy
+
Agent Role
+
User Preferences
+
Relevant Memories
+
Current Location
+
Current Task
+
Live Inventory
+
Live Campaigns
+
Payment Budget
```

AI sadece strateji, açıklama ve sıralama yapmalıdır.

Aşağıdaki kritik veriler deterministik servislerden gelmelidir:

- Fiyat
- Stok
- İndirim
- Kampanya
- Mesafe
- Teslimat ücreti
- Hazırlama süresi
- Escrow durumu

---

## 8. Kişiye Özel Teklif Sistemi

Kişiselleştirme gizli fiyat artırımı şeklinde olmamalıdır.

Önerilen şeffaf model:

```text
Herkese açık temel fiyat
+
Hak kazanılan kampanya veya sadakat indirimi
+
Teslimat seçenekleri
=
Kişiselleştirilmiş teklif
```

Satıcı kampanya kuralları tanımlar:

```text
Son 30 günde 3 sipariş veren müşteriye %5 indirim.
Stok 10’un üzerindeyse 2 kg üzeri alışverişe %3 indirim.
Saat 19.00’dan sonra ekmek ürünlerinde %10 indirim.
İlk siparişe 0.500000 USDC indirim.
```

Merchant agent şu verileri değerlendirir:

- Kullanıcı segmenti
- Ürün stoku
- Kampanya kuralları
- Minimum satış fiyatı
- Müşteri geçmişi
- Saat ve tarih
- Teslimat biçimi
- Ürün miktarı

Deterministik sonuç:

```json
{
  "baseAmountMicroUsdc": 12500000,
  "campaignId": "campaign_loyal_customer",
  "discountMicroUsdc": 625000,
  "finalAmountMicroUsdc": 11875000,
  "reason": "Son 30 günde 3 tamamlanmış sipariş"
}
```

Bu sonuç EIP-712 ile imzalanmalıdır.

---

## 9. Gerçek Zamanlı Stok ve Kampanya

Sistem olay tabanlı çalışmalıdır.

Önemli olaylar:

```text
inventory.updated
inventory.low
inventory.reserved
inventory.released

campaign.created
campaign.activated
campaign.expired
campaign.limit_reached

order.created
order.completed
order.cancelled

payment.escrow_funded
payment.released
payment.refunded

merchant.opened
merchant.closed
```

Stok kaydında versiyon bulunmalıdır:

```text
merchant_inventory
- merchantProductId
- physicalQuantity
- reservedQuantity
- availableQuantity
- version
- updatedAt
```

Teklifte:

```text
inventoryVersion
campaignVersion
```

bulunmalıdır.

Sipariş anında bu versiyonlar yeniden doğrulanmalıdır.

---

## 10. Konum, Yürüme ve Kurye Sistemi

### 10.1 Konum Modları

Kullanıcı şu modlardan birini seçebilmelidir:

```text
Yürüme
Gel-Al
Kurye
Otomatik Seç
```

### 10.2 Yürüme Modu

Örnek varsayılanlar:

```text
Maksimum yarıçap: 1 km
Maksimum yürüyüş süresi: 15 dakika
```

Sadece gerçek yaya rotası sınır içinde kalan mağazalar gösterilmelidir.

### 10.3 Gel-Al Modu

Örnek varsayılanlar:

```text
Maksimum yarıçap: 5 km
Ulaşım: Araç veya toplu taşıma
```

Agent çoklu mağaza rotası oluşturabilmelidir:

```text
Ev
→ Kasap
→ Manav
→ Fırın
→ Ev
```

### 10.4 Kurye Modu

Kurye seçiminde:

- Satıcı kurye destekliyor mu?
- Kullanıcı teslimat bölgesinde mi?
- Minimum sepet var mı?
- Teslimat ücreti nedir?
- Tahmini teslimat süresi nedir?
- Aktif kurye var mı?
- Soğuk ürün taşınabilir mi?
- Çoklu mağaza toplaması destekleniyor mu?

kontrol edilmelidir.

Örnek kurye teklifi:

```json
{
  "merchantId": "merchant_ali_kasap",
  "deliveryMode": "courier",
  "distanceM": 3200,
  "estimatedMinutes": 24,
  "deliveryFeeMicroUsdc": 1400000,
  "courierAvailable": true
}
```

### 10.5 Konum Hesaplama

İki aşamalı arama yapılmalıdır.

#### Aşama 1 — Coğrafi ön filtre

PostGIS ile:

```text
Yürüme: 1.5 km ön filtre
Gel-al: 5 km ön filtre
Kurye: teslimat bölgesi veya maksimum mesafe
```

#### Aşama 2 — Gerçek rota hesabı

Rota servisinden:

```text
walkingDistanceM
walkingDurationMin
drivingDistanceM
drivingDurationMin
```

alınmalıdır.

Haversine yalnızca ilk eleme için kullanılmalıdır.

### 10.6 Teslimat Bölgeleri

Satıcı harita üzerinde alan çizebilmelidir.

```text
delivery_zones
- id
- merchantId
- name
- polygon
- deliveryFeeMicroUsdc
- minimumOrderMicroUsdc
- estimatedMinutes
- active
```

PostGIS, kullanıcının konumunun polygon içinde olup olmadığını kontrol etmelidir.

### 10.7 Konum Gizliliği

- Açık izin alınmalıdır.
- Kullanıcı mahalle seviyesinde yaklaşık konum seçebilmelidir.
- Kesin koordinat saklama süresi sınırlı olmalıdır.
- Satıcıya ödeme öncesi tam ev konumu verilmemelidir.
- Gel-al siparişinde satıcının ev adresine erişimi olmamalıdır.

Ayrım:

```text
Discovery Location
→ Satıcı bulmak için yaklaşık konum

Delivery Address
→ Sadece kurye siparişi onaylandığında kullanılır
```

---

## 11. Veri Saklama Mimarisi

### 11.1 Geliştirme ve Demo

Mevcut `node:sqlite` yapısı mock-first ve lokal demo için korunabilir.

### 11.2 Üretim Ortamı

Önerilen üretim altyapısı:

```text
PostgreSQL
├── Hesaplar
├── Cüzdanlar
├── Siparişler
├── Ürünler
├── Stok
├── Kampanyalar
├── Ödemeler
├── Konuşmalar
└── Agent hafızaları

PostGIS
└── Konum, mesafe, teslimat alanları

pgvector
└── Anlamsal hafıza ve konuşma arama

Redis
├── Aktif oturum
├── Geçici görev durumu
├── Cache
├── Kilitler
└── Gerçek zamanlı agent state

Object Storage
├── Ürün görselleri
├── Faturalar
└── Dışa aktarılan raporlar

Blockchain
├── Escrow
├── Settlement
├── Receipt referansları
└── Hafıza bütünlük root’ları
```

### 11.3 Veri Yerleşimi

| Veri | Saklama Yeri |
|---|---|
| Kullanıcı hesabı | PostgreSQL |
| Cüzdan bağlantıları | PostgreSQL |
| Profil tercihleri | PostgreSQL |
| Konuşma mesajları | PostgreSQL / şifreli object storage |
| Anlamsal hafıza | pgvector |
| Aktif görev state’i | Redis |
| Sipariş ve ödeme geçmişi | PostgreSQL |
| Escrow hareketleri | Blockchain + PostgreSQL indeks |
| Ürün ve stok | PostgreSQL |
| Kampanyalar | PostgreSQL |
| Mağaza konumu | PostGIS |
| Kurye alanı | PostGIS |
| Ürün görselleri | Object storage |
| Hafıza Merkle root | Blockchain |

Konuşmalar ve kişisel tercihler doğrudan blockchain üzerinde tutulmamalıdır.

---

## 12. Önerilen Veri Tabloları

```text
accounts
wallets
sessions
user_profiles
user_preferences

merchant_organizations
merchant_members
merchant_wallets
merchant_settings
merchant_delivery_zones

agents
agent_profiles
agent_memories

conversations
conversation_messages
saved_prompts
shopping_templates

products
merchant_products
inventory
inventory_movements
warehouses

campaigns
campaign_rules
campaign_usage

orders
order_items
escrows
payment_events
receipts

memory_roots
audit_logs
```

### 12.1 Payment Ledger

```text
payment_events
- id
- accountId
- merchantId
- taskId
- orderId
- type
- direction
- amountMicroUsdc
- status
- txHash
- network
- idempotencyKey
- createdAt
```

Tüm tutarlar integer micro-USDC olarak tutulmalıdır. Float kullanılmamalıdır.

---

## 13. Servis Mimarisi

Önerilen üst seviye yapı:

```text
/apps/web
    Kullanıcı ve satıcı arayüzü

/apps/platform-api
    Hesaplar
    Cüzdan oturumu
    Profiller
    Konuşma geçmişi
    Ödeme geçmişi
    Satıcı organizasyonları

/apps/agent-runtime
    User Agent
    Merchant Agent
    Context Builder
    Memory Retriever
    Memory Writer

/apps/marketplace-service
    Ürün kataloğu
    Stok
    Kampanyalar
    Teklif motoru

/apps/location-service
    PostGIS sorguları
    Yürüyüş/araç rotaları
    Teslimat bölgeleri

/apps/courier-service
    Kurye uygunluğu
    Ücret
    ETA
    Teslimat takibi

/apps/payment-service
    x402 mikro ödemeler
    Escrow
    Payment ledger
```

İlk aşamada bunların tamamı ayrı servis olmak zorunda değildir. `platform-api` içinde modüller olarak başlayabilir, ihtiyaç arttıkça ayrılabilir.

---

## 14. x402 Maliyet ve Ölçekleme Stratejisi

### 14.1 Agent Her Zaman LLM Değildir

Agent şu bileşenlerden oluşur:

- Kimlik
- Hafıza
- Yetki
- Araçlar
- İş kuralları
- İsteğe bağlı LLM katmanı

Stok, fiyat, kampanya, teslimat ve hazırlama süresi için LLM çağrısı yapılmamalıdır.

Satıcı agent’ı doğrudan:

```text
getInventory()
calculateCampaign()
calculateDeliveryFee()
calculatePreparationTime()
signQuote()
```

çalıştırmalıdır.

İdeal bir alışveriş görevi:

```text
1 LLM çağrısı → İsteği planlama
0 LLM çağrısı → Satıcı stok/fiyat cevapları
1 LLM çağrısı → Sonuçları açıklama ve sıralama
```

### 14.2 Kademeli Satıcı Keşfi

Bölgede yüzlerce satıcı olduğunda hepsine ücretli sorgu gönderilmemelidir.

```text
1. Ücretsiz veya çok ucuz keşif
2. Konum ve kategori filtresi
3. İlk 10–20 satıcının kaba uygunluk kontrolü
4. En uygun 3–5 satıcıdan ücretli teklif
5. En iyi 1–2 satıcıyla pazarlık veya rezervasyon
```

Örnek:

```text
Bölgede toplam satıcı:       420
İlgili kategoride:            38
Konum sınırında:               9
Stok sinyali uygun:            5
Ücretli teklif alınan:         3
Pazarlık yapılan:              1
```

### 14.3 Paralel Sorgulama

Satıcı istekleri küçük JSON çağrıları olduğundan paralel çalıştırılabilir.

Önerilen sınırlar:

```text
concurrency limit: 5–10
timeout: 1–2 saniye
total task deadline: 4–6 saniye
```

Aynı anda yüzlerce satıcıya fan-out yapılmamalıdır.

### 14.4 Araştırma Bütçesi UX’i

Kullanıcı her mikro işlem için ayrı onay vermemelidir.

Kötü UX:

```text
Ali Kasap stok sorgusu için ödeme yap?
Can Kasap teklif sorgusu için ödeme yap?
```

Önerilen UX:

```text
Araştırma bütçesi: En fazla 0.010000 USDC

Agent bu bütçe içinde:
✓ Yakındaki satıcıları araştırabilir
✓ Stok ve teklif alabilir
✓ Bir satıcıyla pazarlık yapabilir
✓ Ürünü geçici rezerve edebilir

Ana alışveriş ödemesi ayrıca onaylanacaktır.
```

Görev sonunda:

```text
Yetkilendirilen:  0.010000 USDC
Harcanan:         0.006300 USDC
Kullanılmayan:    0.003700 USDC
```

### 14.5 Batch Settlement

Her küçük sorguyu ayrı on-chain settlement yapmak yerine:

```text
Kullanıcı araştırma bütçesi yetkilendirir
→ Her çağrı için off-chain imzalı harcama kaydı oluşur
→ Satıcılar voucher biriktirir
→ Görev sonunda veya eşikte toplu settlement yapılır
```

modeli tercih edilmelidir.

### 14.6 Ücretlendirme Modeli

Önerilen hibrit yapı:

```text
Keşif ve temel stok kontrolü → ücretsiz veya marketplace destekli
Ayrıntılı teklif             → düşük ücretli
Pazarlık                     → kullanıcı ücretli
Rezervasyon                  → kullanıcı ücretli
Ana sipariş                  → ayrı kullanıcı onayı
```

### 14.7 LLM Maliyeti Optimizasyonu

- Merchant agent’larda LLM varsayılan olarak kullanılmamalı
- Sepet sorguları toplu yapılmalı
- Her SKU için ayrı çağrı yapılmamalı
- Küçük görevlerde küçük model kullanılmalı
- Tüm konuşma geçmişi modele gönderilmemeli
- Yapısal profil + 3–5 ilgili hafıza + aktif görev yeterli olmalı
- Basit sonuç metinleri şablonla üretilebilmeli

---

## 15. Private Agent Memory ve ZK Yaklaşımı

### 15.1 Temel İlke

ZK bir şifreleme yöntemi değildir. ZK, gizli veriyi açıklamadan o veri hakkında bir ifadenin doğru olduğunu kanıtlamak için kullanılmalıdır.

Tam konuşma geçmişinin şifreli biçimde on-chain tutulması önerilmez.

Nedenleri:

- Ciphertext herkese açık kalır
- Cüzdan ve işlem zamanı görünür
- Mesaj uzunluğu ve kullanım sıklığı sızabilir
- Zincir verisi kalıcıdır
- Anahtar ileride ele geçirilirse eski konuşmalar açılabilir
- Maliyet ve state büyümesi yaratır

### 15.2 Önerilen Mimari

```text
Kullanıcı cüzdanı
       │
       ▼
Wallet Authentication
       │
       ▼
Private Memory Vault
├── Şifreli konuşmalar
├── Şifreli episodik hafıza
├── Kullanıcı tercihleri
└── AI için seçilmiş bağlam
       │
       ├── PostgreSQL / Object Storage
       │
       └── Merkle Tree
                │
                ▼
       Base Memory Registry
       ├── Merkle root
       ├── Memory version
       ├── Agent commitment
       └── Update timestamp
```

### 15.3 Off-chain Tutulacaklar

- Konuşma mesajları
- Prompt geçmişi
- Agent cevapları
- Kullanıcı tercihleri
- Alışveriş özetleri
- Embedding verileri
- Hafıza etiketleri

### 15.4 On-chain Tutulacaklar

```text
memoryRoot
agentCommitment
memoryVersion
previousRoot
updatedAt
authorizationNullifier
```

Örnek kontrat yapısı:

```solidity
struct MemoryState {
    bytes32 root;
    uint64 version;
    uint64 updatedAt;
}
```

Her mesajda işlem yapılmamalıdır.

Toplu güncelleme seçenekleri:

```text
20 mesajda bir
Konuşma tamamlandığında
24 saatte bir
Sipariş tamamlandığında
```

### 15.5 Anahtar Yönetimi

Şifreleme anahtarı yalnızca cüzdan imzasından türetilmemelidir.

Önerilen model:

```text
Kullanıcı cihazı
→ Rastgele Data Encryption Key üretir
→ Konuşmalar bu anahtarla şifrelenir
→ Anahtar passkey/recovery anahtarıyla sarılır
```

```text
User Master Key
├── Conversation Key 1
├── Conversation Key 2
├── Profile Memory Key
└── Payment Metadata Key
```

Cüzdanın görevi:

- Kimlik doğrulama
- Memory Vault erişimi imzalama
- Anahtar değişikliğini yetkilendirme

Kurtarma yöntemleri:

- Passkey
- Şifreli recovery dosyası
- İkinci cihaz
- Sosyal kurtarma
- Kullanıcı kontrollü yedek anahtar

### 15.6 AI Şifreli Hafızayı Nasıl Kullanır?

#### MVP — Memory Service İçinde Çözme

```text
Şifreli hafıza
→ Yetki kontrolü
→ Memory Service içinde çözme
→ İlgili 3–5 hafızayı seçme
→ LLM’e minimum bağlam gönderme
```

#### Daha Gizli Model — Kullanıcı Cihazında Çözme

```text
Şifreli geçmiş
→ Tarayıcı/mobil cihazda çözme
→ Yerel relevance search
→ Sadece seçilen bağlamı LLM’e gönderme
```

#### İleri Aşama — TEE

```text
Encrypted Memory
→ TEE
→ Attested Agent Runtime
→ LLM veya yerel model
→ Şifreli sonuç
```

ZK doğrulama için, TEE gizli ve düşük gecikmeli işlem için kullanılabilir.

### 15.7 ZK Kullanım Alanları

#### Sadakat Kanıtı

Kullanıcı geçmişi açıklanmadan:

```text
Son 30 günde en az 3 tamamlanmış sipariş var.
```

kanıtlanabilir.

#### Harcama Segmenti

```text
Son 90 gündeki harcama 100 USDC’nin üzerinde.
```

Gerçek miktar açıklanmaz.

#### Araştırma Bütçesi Kanıtı

```text
Bu görevdeki toplam x402 harcaması
0.010000 USDC sınırını aşmadı.
```

#### Kampanya Uygunluğu

Kullanıcının:

- Kampanya bölgesinde olduğu
- Minimum sepet koşulunu sağladığı
- Kampanyayı daha önce kullanmadığı

ayrıntılar açıklanmadan kanıtlanabilir.

#### Hafıza Güncelleme Yetkisi

```text
Yeni memory root,
önceki geçerli root’un
kullanıcı tarafından yetkilendirilmiş güncellemesidir.
```

#### Yaş veya Üyelik Kanıtı

```text
18 yaşından büyük
```

veya

```text
Doğrulanmış satıcı organizasyonu üyesi
```

olduğu açıklama yapılmadan kanıtlanabilir.

### 15.8 ZK İçin Yapılmaması Gerekenler

- Her mesaj için ZK proof üretmek
- Her LLM token’ını doğrulamaya çalışmak
- Tüm konuşma geçmişini kontrat storage’ına yazmak
- Anahtarı yalnızca wallet signature’dan türetmek
- Bütün hafızayı her LLM çağrısına göndermek

### 15.9 Doğru ZK Hedefi

LLM’in her token’ını kanıtlamak yerine:

- Hafıza kaydı kullanıcıya ait mi?
- Hafıza değiştirilmiş mi?
- Agent doğru hafıza sürümünü kullandı mı?
- Kampanya koşulları sağlandı mı?
- Araştırma bütçesi aşılmadı mı?
- Teklif doğru ve imzalı verilere dayanıyor mu?

soruları kanıtlanmalıdır.

---

## 16. Private Agent Memory Kullanıcı Arayüzü

Kullanıcı ekranında:

```text
Agentımın Hafızası
├── Tercihlerim
├── Geçmiş konuşmalar
├── Alışveriş alışkanlıkları
├── Favori satıcılar
├── Unutmasını istediklerim
└── Doğrulanmış hafıza kaydı
```

Her hafıza için:

```text
Kaynak: 18 Temmuz konuşması
Son kullanım: 22 Temmuz
Şifreleme: Aktif
On-chain bütünlük: Doğrulandı
AI erişimi: İzinli
```

Kullanıcı:

- Bu bilgiyi unut
- AI kullanabilsin/kullanamasın
- Geçici hafıza yap
- Başka cihaza aktar
- Tüm hafızayı dışa aktar
- Yeni hafıza güncellemelerini onayla

aksiyonlarını kullanabilmelidir.

Önerilen ürün mesajı:

> “Agent hafızan sana aittir. Platform geçmişini gizlice değiştiremez; kampanya haklarını alışveriş detaylarını açıklamadan kanıtlayabilirsin.”

---

## 17. Kullanıcı Gözüyle Proje Eleştirileri

### 17.1 Değer Önerisi Netleşmeli

Kullanıcı “neden bunu kullanayım?” sorusuna hızlı cevap almalıdır.

Teknoloji dili yerine:

- Daha az uğraş
- Daha düşük toplam fiyat
- Güvenilir stok bilgisi
- Daha iyi rota
- Güvenli ödeme

öne çıkarılmalıdır.

### 17.2 Cüzdan Giriş Engeli

Kripto kullanmayan kullanıcı için cüzdan zorunluluğu yüksek sürtünme yaratabilir.

Uzun vadede:

- E-posta / telefonla giriş
- Passkey
- Gömülü cüzdan
- Standart kart ödemesi
- Harici cüzdan opsiyonu

sunulabilir.

### 17.3 Aramaya Para Ödeme Algısı

Her stok sorgusunun ayrı ücretli gösterilmesi kötü UX yaratır.

Kullanıcıya maksimum araştırma bütçesi gösterilmeli, mikro işlemler ayrıntı ekranında tutulmalıdır.

### 17.4 Teknik Kavramlar Gizlenmeli

Ana kullanıcı akışında:

- EIP-712
- Nonce
- Transaction hash
- x402
- Escrow kontratı

öne çıkarılmamalıdır.

Kullanıcıya:

```text
Ödemen güvende.
Satıcı teslimatı doğrulayınca aktarılacak.
```

mesajı verilmelidir.

### 17.5 Çoklu Satıcı Karmaşıklığı

Alt tarafta birden fazla escrow ve satıcı olabilir; kullanıcı tek sipariş deneyimi yaşamalıdır.

```text
Tek kullanıcı siparişi
Tek toplam
Tek durum ekranı
Tek destek talebi
Tek teslimat deneyimi
```

### 17.6 Stok Doğruluğu Kritik

Projenin en büyük gerçek dünya riski stok verisinin güncel olmamasıdır.

Gerekli entegrasyonlar:

- Barkod sistemi
- POS sistemi
- Manuel stok ekranı
- CSV içe aktarma
- Kritik stok uyarıları
- Otomatik rezervasyon

### 17.7 Satıcı Paneli Basit Olmalı

Küçük esnaf için ilk ekran:

```text
Bugün açık mısın?
Ürün fiyatları
Stokta olanlar
Yeni siparişler
Hazırla butonu
Teslim kodu
Kazançlar
```

şeklinde olmalıdır.

Gelişmiş kampanya, agent ve finans ayarları ikinci seviyede açılmalıdır.

### 17.8 Kişiselleştirilmiş Fiyat Güven Sorunu

Gizli fiyat artırımı yapılmamalıdır.

Kişiselleştirme yalnızca:

- Sadakat indirimi
- Kampanya
- Paket
- Ücretsiz teslimat
- Tercihe göre sıralama

üzerinden uygulanmalıdır.

### 17.9 Kurye Operasyonu Zordur

İlk sürümde kendi kurye ağı yerine:

```text
Satıcının kendi kuryesi
veya
Harici teslimat sağlayıcısı adaptörü
```

kullanılmalıdır.

### 17.10 Anlaşmazlık Sistemi Genişletilmeli

Teslim kodu yalnızca teslimi kanıtlar; ürün kalitesini kanıtlamaz.

Gerekli özellikler:

- Eksik ürün bildir
- Yanlış ürün bildir
- Bozuk ürün bildir
- Fotoğraf yükle
- Kısmi iade talep et
- Destek kaydı oluştur

---

## 18. Geliştirme Yol Haritası

### Aşama 1 — Hesap, Geçmiş ve Temel Hafıza

- Cüzdan imzasıyla oturum açma
- Account ve wallet tabloları
- Kullanıcı profili
- Konuşma geçmişi
- Kaydedilmiş promptlar
- Ödeme geçmişi
- Sipariş geçmişi
- Yapısal tercih hafızası
- “Agentımın bildikleri” ekranı

### Aşama 2 — Satıcı Organizasyonu ve Paneli

- Satıcı organizasyonu
- Satıcı üyeleri ve roller
- Mağaza profili
- Ürün kataloğu
- Stok yönetimi
- Sipariş operasyon ekranı
- Escrow ve gelir geçmişi
- Agent ayarları

### Aşama 3 — Konum ve Teslimat

- PostGIS
- 1 km yürüme modu
- 5 km gel-al / kurye modu
- Gerçek rota mesafesi
- Teslimat alanları
- Teslimat ücreti
- Tahmini teslimat süresi
- Satıcının kendi kuryesi adaptörü

### Aşama 4 — Kampanya ve Kişiye Özel Teklif

- Kampanya kural motoru
- Sadakat segmentleri
- Kullanıcıya özel indirim uygunluğu
- Campaign version
- Inventory version
- Teklif imzası
- Şeffaf kampanya gerekçesi

### Aşama 5 — x402 Ölçekleme

- Kademeli satıcı keşfi
- Paralel sorgu havuzu
- Araştırma bütçesi yetkilendirmesi
- Off-chain voucher
- Batch settlement
- Rate limit
- Timeout
- Circuit breaker

### Aşama 6 — Private Agent Memory

- Şifreli off-chain konuşma geçmişi
- Kullanıcı kontrollü anahtar
- Memory Vault
- Merkle tree
- Base Memory Registry
- Toplu root güncellemesi
- Hafıza dışa aktarma ve silme

### Aşama 7 — ZK Kanıtları

- Sadakat kanıtı
- Kampanya uygunluk kanıtı
- Araştırma bütçesi kanıtı
- Tek kullanımlık nullifier
- Hafıza güncelleme yetkisi

### Aşama 8 — İleri Gizlilik ve Operasyon

- TEE içinde agent runtime
- Yerel/private embedding
- Gelişmiş selective disclosure
- Çalışan ve rol yönetimi
- Çoklu şube
- Çoklu depo
- Gelişmiş raporlama
- Harici kurye entegrasyonları

---

## 19. Öncelikli MVP Kapsamı

İlk uygulanması önerilen çekirdek sürüm:

```text
Cüzdanla giriş
+
Kullanıcı hesabı
+
Konuşma ve prompt geçmişi
+
Ödeme geçmişi
+
Satıcı organizasyonu
+
Ürün ve stok paneli
+
1 km yürüme / 5 km teslimat seçeneği
+
Deterministik kampanya motoru
+
Kullanıcıya ait mantıksal agent
+
Şifreli off-chain hafıza
+
On-chain Merkle root
```

ZK’nın ilk gerçek kullanım alanı:

```text
Sadakat kampanyasına uygunluk
ve
Araştırma bütçesi sınırının aşılmadığını kanıtlama
```

olmalıdır.

---

## 20. Ana Mimari Kararlar

1. Her kullanıcı için ayrı LLM değil, ayrı mantıksal agent oluşturulacak.
2. Kullanıcı ve satıcı aynı account altında farklı rollere sahip olabilecek.
3. Satıcı tek cüzdan değil, merchant organization olarak modellenilecek.
4. Fiyat, stok ve kampanya deterministik servislerden gelecek.
5. LLM yalnızca planlama, yorumlama ve açıklama katmanı olacak.
6. Konuşma geçmişi şifreli olarak off-chain tutulacak.
7. On-chain yalnızca escrow, settlement, receipt ve hafıza root’ları tutulacak.
8. ZK, tam konuşma depolamak için değil, gizli koşulları kanıtlamak için kullanılacak.
9. Kullanıcının kesin konumu sadece gerektiğinde ve sınırlı süreyle kullanılacak.
10. x402 mikro ödemeleri kullanıcıya tek tek onaylatılmayacak; görev bütçesi ve batch settlement uygulanacak.
11. Çoklu satıcı karmaşıklığı kullanıcıdan gizlenecek; tek sipariş deneyimi sunulacak.
12. Stok doğruluğu, kampanya doğruluğu ve sipariş anı yeniden doğrulaması temel güvenlik koşulu olacak.

---

## 21. Sonuç

Bu genişleme ile Agent Mahalle aşağıdaki ürüne dönüşür:

```text
Yerel satıcıları keşfeden
+
Kullanıcı tercihlerini hatırlayan
+
Gerçek stok ve kampanyaları kullanan
+
Konuma göre rota ve teslimat üreten
+
Agent-to-agent mikro ödemeleri yöneten
+
Satıcı operasyonlarını dijitalleştiren
+
Escrow ile ödemeyi güvence altına alan
+
Kullanıcı hafızasını şifreli ve doğrulanabilir tutan
+
ZK ile özel kampanya haklarını kanıtlayabilen
bir yerel ticaret agent platformu
```

