# Faz C — Cüzdan Girişi (SIWE), Hesaplar ve Kişisel Agent

> Önkoşul: Faz 0 + Faz A (Postgres çalışıyor). Faz B'den bağımsız ilerleyebilir
> (imza doğrulama zincire gitmez).

## 1. Yeni servis: `apps/platform-api` (:3002)

- Hono + `@merchantmesh/db`. Sorumluluk (bu fazda): auth, hesaplar, oturumlar, audit log.
  (Konuşma/ledger uçları Faz K'de eklenecek; tablolar hazır.)
- Uçlar:
  - `POST /auth/nonce` → `{ nonce }` (DB'ye yazılır: değer, createdAt, TTL 5 dk,
    kullanılınca silinir).
  - `POST /auth/verify` → body: `{ message, signature }`. viem `parseSiweMessage` +
    `verifySiweMessage`; kontrol: domain, uri, chainId (`CHAIN_ID`), nonce DB'de ve
    kullanılmamış, issuedAt penceresi. Başarıda:
    - cüzdan lowercase aranır; yoksa TEK transaction'da: `accounts` + `wallets` +
      `agents` (isim: "Kişisel Agent") + `agent_profiles` (boş prefs) oluştur.
    - `sessions` kaydı (`tokenHash=sha256(token)`, 7 gün) + `Set-Cookie: mm_session=…;
      HttpOnly; Secure; SameSite=Lax; Path=/`.
    - `audit_logs`'a `auth.login`.
  - `POST /auth/logout` → session revoke + cookie sıfırla.
  - `GET /me` → `{ account, wallet, agent, mode }` (session yoksa 401).
  - `POST /me/mode` → `customer|merchant` geçişi (accounts.active_mode).
- Ortak session middleware `packages/shared/src/auth.ts`'e: cookie'den token → hash →
  sessions lookup (expiresAt/revokedAt) → `accountId, walletAddress` context'e. Bridge ve
  merchant-agents de bu middleware'i kullanabilmeli (DB üzerinden; servisler arası ekstra
  HTTP çağrısı yok).

## 2. Web — wagmi entegrasyonu

- Bağımlılıklar: `wagmi`, `@tanstack/react-query`. Connector: `injected` (MetaMask).
  Chain objesi `chainConfig.ts`'ten (`NEXT_PUBLIC_CHAIN_*` env'leri — RPC, chainId,
  explorer; Faz B değerleri).
- `WalletWidget` yeniden yazılır: Bağla → yanlış ağdaysa `switchChain` iste → SIWE imza →
  `/auth/verify` → `GET /me` ile hesap görünümü (adres, agent adı, çıkış). Simüle cüzdan
  widget'ı yalnızca `NEXT_PUBLIC_MOCK=true` iken render edilir.
- Oturum yoksa alışveriş akışı kilitli: prompt kutusu yerine "cüzdan bağla" kartı.
- API çağrılarında `credentials: 'include'`; platform-api CORS'u web origin'ine
  `Access-Control-Allow-Credentials` ile açılır (wildcard değil).

## 3. Bridge — task'ların hesaba bağlanması

- `POST /tasks` artık session zorunlu: `tasks.account_id`, `tasks.agent_id` dolar
  (Postgres `tasks` tablosuna yazım bu fazda başlar; bridge'in SQLite mock path'i test
  için kalır, canlı path `DATABASE_URL` varlığıyla seçilir).
- `GET /tasks/:id*` uçları yalnızca sahibine döner (accountId eşleşmesi, yoksa 404).
- Basit konuşma kaydı: task oluşturulunca `conversations` + kullanıcı prompt'u
  `conversation_messages(role=user)`; options_ready ve receipt_ready olayları
  `system_event` mesajı olarak eklenir. (Tam timeline Faz K.)

## 4. Güvenlik kontrol listesi

- Nonce tek kullanımlık — verify başarısız olsa bile nonce yakılır.
- SIWE mesajındaki `address` ile imza adresi eşleşmeli; farklı chainId reddedilir.
- Session cookie'siz `Authorization: Bearer` de kabul edilir (Postman/e2e testleri için).
- Rate limit: `/auth/*` uçlarına IP başına dakikada 10 (Redis).

## Kabul kriterleri

- [ ] Manuel e2e: MetaMask bağla → imzala → `/me` dolu; sayfa yenile → oturum sürüyor;
      logout → 401; farklı cüzdan → farklı hesap + farklı agentId.
- [ ] Aynı cüzdanla ikinci giriş yeni account YARATMAZ (unique) — test var.
- [ ] Sahiplik: A hesabının task'ını B hesabı göremiyor — test var.
- [ ] Nonce replay testi: aynı imza ikinci kez 401.
- [ ] `pnpm dev` artık 4 servisi başlatır (web, platform-api, bridge, merchants);
      README güncel.
