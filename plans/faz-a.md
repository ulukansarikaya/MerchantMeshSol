# Faz A — PostgreSQL + PostGIS + pgvector + Redis Temeli

> Önkoşul: Faz 0 merge edilmiş olmalı. Bu faz servis davranışını değiştirmez; veri
> altyapısını kurar ve seed'i taşır. Mevcut SQLite akışı bozulmaz.

## 1. Geliştirme altyapısı (Docker)

- Repo köküne `docker-compose.dev.yml`:
  - `db`: PostGIS + pgvector birlikte gerekir. `postgis/postgis:16-3.4` tabanlı küçük bir
    `infra/db.Dockerfile` yaz: `apt-get install -y postgresql-16-pgvector`. Port 5432,
    volume, `POSTGRES_DB=merchantmesh`.
  - `redis`: `redis:7-alpine`, port 6379.
- Root package.json script'leri: `db:up` (docker compose up -d), `db:down`,
  `db:migrate`, `db:seed:pg`.
- KARAR: Docker yoksa (kullanıcının makinesinde sorun çıkarsa) yedek yol, kullanıcıya
  yönetilen bir Postgres (Neon/Supabase) bağlantı dizesi sorulmasıdır — extension'ları
  destekleyen bir servis olmalı. Kod tarafı yalnızca `DATABASE_URL` bilir.

## 2. `packages/db` (yeni workspace paketi)

- Bağımlılıklar: `drizzle-orm`, `drizzle-kit`, `pg`, `ioredis`.
- Yapı:
  ```
  packages/db/src/schema/     core.ts, agentic.ts, market.ts, orders.ts, ops.ts
  packages/db/src/client.ts   pg Pool + drizzle instance (DATABASE_URL)
  packages/db/src/redis.ts    ioredis client (REDIS_URL)
  packages/db/src/repos/      alan bazlı repository fonksiyonları (faz ilerledikçe dolar)
  packages/db/migrations/     drizzle-kit çıktıları (SQL)
  ```
- Tablolar: `LIVE_PLAN_V2.md §17`'deki tam liste. Bu fazda hepsinin şeması tanımlanır
  (sonraki fazlar kolon eklemek yerine hazır tabloları kullanır). Önemli ayrıntılar:
  - Tüm para kolonları `bigint` (drizzle `bigint({ mode: 'bigint' })`).
  - `merchant_locations.location` ve `warehouses.location` → `geography(Point,4326)`
    (drizzle custom type; ham SQL migration'da `CREATE EXTENSION IF NOT EXISTS postgis`).
  - `agent_memories.embedding` → `vector(1536)` (pgvector custom type; boyut env ile değil
    sabit — provider değişirse migration yazılır). `CREATE EXTENSION IF NOT EXISTS vector`.
  - `payment_events`: `(chain_id, tx_hash, log_index)` UNIQUE (null log_index'e izin veren
    partial unique index; off-chain olaylar için txHash null olabilir).
  - `payment_proofs`: `(chain_id, tx_hash)` UNIQUE — x402 replay koruması.
  - `sessions.token_hash` UNIQUE; `wallets.address` UNIQUE (lowercase saklanır).
  - `inventory` invariant'ı CHECK constraint ile: `available_quantity >= 0`,
    `reserved_quantity >= 0`, `available_quantity = physical_quantity - reserved_quantity`.
  - `campaign_usage`: `(campaign_id, account_id, order_id)` UNIQUE.
  - Her tabloda `created_at timestamptz default now()`; mutasyona uğrayanlarda `updated_at`
    + `version integer` (optimistic locking gereken yerler: inventory, merchant_products,
    campaigns).

## 3. Seed taşıma

- `scripts/seed-pg.ts`: mevcut 5 esnafı yeni modele taşır:
  - Her esnaf için `merchant_organizations` + `merchant_wallets` (mevcut dev adresleri) +
    `merchant_settings` (pazarlık/rezervasyon kuralları) + `merchant_locations` (mevcut
    koordinatlar, PostGIS point) + `warehouses` (tek ana depo) kaydı.
  - `products` = kanonik SKU kataloğu (`CANONICAL_SKUS`); `merchant_products` = esnaf
    fiyat/min-fiyat eşlemeleri; `inventory` = mevcut stok sayıları (physical=available,
    reserved=0).
- Seed idempotent olmalı (tekrar çalıştırınca duplicate üretmez — upsert).

## 4. Smoke testler

- `packages/db/test/db.test.ts` (vitest, `DATABASE_URL` yoksa `describe.skipIf` ile atlanır
  — CI/lokalde DB olmadan suite kırılmaz):
  - Migration sonrası: PostGIS `ST_DWithin` ile Kızılay noktasından 1500m içinde 5 esnaf döner.
  - pgvector: bir embedding insert + `<->` mesafe sorgusu çalışır.
  - inventory CHECK constraint'i negatif available'ı reddeder.
  - bigint para kolonuna 4_500_000n yazılıp aynen okunur.

## Kabul kriterleri

- [ ] `pnpm db:up && pnpm db:migrate && pnpm db:seed:pg` temiz makinede çalışır.
- [ ] Smoke testler DB varken yeşil; DB yokken suite atlanır ama diğer testler geçer.
- [ ] Mevcut `pnpm test` (SQLite suite'leri) ve `pnpm demo` etkilenmez.
- [ ] README'ye "Canlı sürüm altyapısı" bölümü: docker komutları + DATABASE_URL/REDIS_URL.
