# Pasalho Lite — Development Setup

## Requirements

- Node.js 22.x
- PostgreSQL 15+
- npm

## 1. Environment

Copy:

```bash
cp .env.example .env
```

Set:

- DATABASE_URL
- AUTH_SECRET
- APP_URL
- SESSION_TTL_HOURS
- SEED_OWNER_EMAIL
- SEED_OWNER_PASSWORD
- SEED_OWNER_NAME

Never commit the real .env file.

## 2. Install

```bash
npm install
```

The postinstall script generates the Prisma Client.

## 3. Validate Prisma

```bash
npm run prisma:validate
```

## 4. Apply migrations

```bash
npm run db:migrate:deploy
```

For V1, committed migrations are the source of truth. Do not use `prisma db push` as the production migration process.

## 5. Seed

```bash
npm run db:seed
```

The seed is idempotent and creates/updates:

- Central Warehouse — code `WAREHOUSE_MAIN`
- Pasalho Store — code `STORE_MAIN`
- Owner/Admin account from seed environment variables

Do not use placeholder credentials in production.

## 6. Run

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## 7. Verification

Before committing:

```bash
npm run prisma:validate
npm run typecheck
npm run lint
npm test
npm run build
```

CI additionally applies migrations to a fresh PostgreSQL service, seeds it, and starts the production build before calling `/api/health`.

## Phase 0 behavior

- `/login` authenticates active users.
- The session token is random and only an HMAC digest is persisted.
- The session cookie is HttpOnly and becomes Secure in production.
- Protected application pages redirect unauthenticated users to login.
- `/api/admin/status` performs an Owner/Admin role check on the server.
- `/api/health` verifies application and PostgreSQL connectivity.
