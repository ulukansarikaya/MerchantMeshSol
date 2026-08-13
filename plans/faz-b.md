# Faz B — Arc Testnet: Kontrat Deploy + Gerçek Chain Provider'lar

> Önkoşul: Faz 0. (Faz A'ya bağımlı değildir; paralel yürüyebilir.)
> Bu fazın sonunda zincir katmanı tamamen gerçektir; mock chain yalnızca test suite'inde kalır.

## 1. Arc parametrelerini doğrula (İLK İŞ — web araştırması)

- Circle'ın **Arc** ağının güncel **testnet** parametrelerini resmi kaynaklardan doğrula
  (Circle docs / chainlist): RPC URL, chainId, explorer URL, native gas modeli, USDC
  adresi (Arc'ta USDC native/öntanımlı token'dır — ERC-20 arayüzüyle erişim adresini bul),
  faucet adresi.
- Bulguları `contracts/deployments/arc-testnet.md` dosyasına yaz (tarih + kaynak linkleriyle)
  ve `.env.example`'daki `CHAIN_*` bloğunu gerçek değerlerle doldur.
- KARAR: Arc'a erişim/faucet o gün engelliyse kullanıcıya bildir ve onayıyla aynı adımları
  Base Sepolia değerleriyle uygula (kod farkı yok); Arc açılınca yalnızca env + yeniden
  deploy gerekir.
- DİKKAT: Arc'ta gas token USDC ise `fund()` içindeki ERC-20 `transferFrom` akışının ve gas
  hesabının davranışını smoke testte açıkça doğrula; sorun çıkarsa durup kullanıcıya bildir.

## 2. Araç kurulumu ve deploy

- Foundry'yi Windows'a kur: GitHub `foundry-rs/foundry` releases'tan
  `foundry_*_win32_amd64.zip` indir, `forge.exe/cast.exe/anvil.exe`'yi
  `C:\Users\PC\.foundry\bin`'e aç, PATH'e ekle. `forge install foundry-rs/forge-std
  OpenZeppelin/openzeppelin-contracts` (contracts/ altında) → `forge test` İLK KEZ gerçek
  koşulacak; kırmızı çıkan varsa önce düzelt.
- Kurulum imkânsız olursa yedek yol: `scripts/deploy-contracts.ts` — `solc` npm paketi ile
  derle, viem `deployContract` ile at. (Foundry tercih edilir; yedek yolu yalnızca gerekirse yaz.)
- Deployer/relayer: `cast wallet new` (veya viem) ile **yeni** anahtar üret — dev/anvil
  anahtarları canlıda KULLANILMAZ. Adresi kullanıcıya bildir (faucet'ten fonlaması için) ve
  fonlanana kadar bekle.
- Deploy sırası: OrderEscrow(USDC_ADDRESS) → MerchantDirectory → OrderReceipt →
  her seed esnafı için `setMerchantWallet(merchantId, wallet)` + `listMerchant(...)`.
- Esnaf cüzdanları: 5 esnaf için de **yeni** anahtar üret; `.env`'e
  `MERCHANT_<SLUG>_PRIVATE_KEY` olarak yaz (gerçek değerler `.env`'de, örnekleri
  `.env.example`'da boş). Esnaf adresleri seed'lerdeki dev adreslerinin yerine geçer
  (seed-pg + merchant DB güncellenir). Esnaf cüzdanlarına gas için küçük fon gerektiğini
  kullanıcıya bildir.
- Çıktı: adresler `contracts/deployments/arc-testnet.json` (chainId, blok no, tx hash'leriyle).

## 3. Bridge tarafı — `EvmChainProvider`

`apps/local-agent-bridge/src/chain.ts` içine gerçek implementasyon (mock sınıf test için kalır):

- `verifyFund(txHash)` → tx receipt bekle (`CHAIN_MIN_CONFIRMATIONS`), `OrderFunded`
  event'ini parse et → `{escrowOrderId, merchantId, buyer, amount, quoteHash}` döndür.
  (Yeni akışta fonlamayı frontend yapar; bridge yalnızca doğrular — `fund()` server-side
  imzalanmaz.)
- `refund(escrowOrderId)` ve `createReceipt(...)` → relayer anahtarıyla `writeContract`.
- `getEscrow(escrowOrderId)` → `getOrder` view çağrısı.
- `userRelease` → KARAR: canlıda bu da frontend'den kullanıcı cüzdanıyla atılır; provider'da
  yalnızca doğrulama kalır.
- viem client'ları tek yerden: `packages/shared/src/chainConfig.ts` (env'den chain objesi
  üretir; web dahil her taraf bunu kullanır).

## 4. Merchant tarafı — gerçek `chainClient`

`apps/merchant-agents/src/chainClient.ts`: `EvmMerchantChainClient` — esnafın kendi
anahtarıyla `markPreparing/markReady/confirmPickup` `writeContract` + receipt bekleme.
`MOCK_CHAIN=false` iken bridge'in `/chain/*` endpoint'lerine gidilmez.

## 5. Smoke test — `scripts/chain-smoke.ts`

Gerçek ağda uçtan uca kanıt (relayer + 1 esnaf + 1 test alıcı anahtarıyla):
approve → fund → markPreparing → markReady → confirmPickup(doğru kod) → esnaf USDC bakiyesi
arttı; ayrıca yanlış kodun revert ettiğini ve deadline sonrası refund'un çalıştığını dener.
Her adımda explorer linki basar.

## Kabul kriterleri

- [ ] `forge test` yeşil (kurulduysa) — sonuç DECISIONS.md'ye not edilir.
- [ ] `pnpm tsx scripts/chain-smoke.ts` Arc testnet'te (veya onaylı yedek ağda) happy path +
      yanlış kod + refund senaryolarını geçer, explorer linkleri gerçek.
- [ ] `contracts/deployments/arc-testnet.json` + `.md` mevcut ve commit'li; `.env`'de gerçek
      değerler var ama `.env` commit'lenmemiş.
- [ ] Mevcut mock test suite'leri hâlâ yeşil.
