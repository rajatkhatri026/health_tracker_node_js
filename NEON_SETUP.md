# Neon Postgres Setup (Blocked Port 5432)

## Problem

TCP port 5432 is blocked on the network. Standard `pg` pool connections to Neon fail with `P1001: Can't reach database server`. The Neon serverless HTTP driver must be used instead, which communicates over HTTPS (port 443).

## Steps That Worked

### 1. Install the Neon serverless driver and adapter

```bash
npm install @neondatabase/serverless @prisma/adapter-neon
```

### 2. Update `src/utils/prisma.ts`

Replace the `pg.Pool` + `PrismaPg` setup with `PrismaNeonHttp`:

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaNeonHttp } from '@prisma/adapter-neon';

const adapter = new PrismaNeonHttp(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter } as never);

export default prisma;
```

> Do NOT call `neon()` yourself — `PrismaNeonHttp` handles it internally.

### 3. Update the dev script in `package.json`

Add `-r dotenv/config` so env vars are loaded before any module initializes:

```json
"dev": "ts-node-dev --respawn --transpile-only -r dotenv/config src/server.ts"
```

This is required because TypeScript `import` statements are hoisted, meaning `prisma.ts` can initialize before `import 'dotenv/config'` in `server.ts` runs.

### 4. Run migrations manually via Neon SQL Editor

Since `prisma migrate dev` also uses port 5432, generate the SQL locally and run it in the Neon dashboard:

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
```

Copy the output and paste it into **Neon Dashboard → SQL Editor → Run**.

### 5. Connection string

Use the **pooled** connection string from Neon dashboard with `sslmode=require`:

```
DATABASE_URL="postgresql://<user>:<password>@<endpoint>.neon.tech/<db>?sslmode=require"
```

## Notes

- `prisma.$connect()` succeeding does not mean queries will work — it only opens a connection pool.
- `PrismaNeon` (WebSocket pool) and `PrismaNeonHttp` (HTTP) are different exports from `@prisma/adapter-neon`. Use `PrismaNeonHttp` for HTTP-only environments.
- Future schema changes: re-run `prisma migrate diff` and execute the SQL in the Neon SQL Editor.
