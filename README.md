# TinyPay Backend

Chat-native wallet + group-finance agent over Telegram and WhatsApp. See [docs/SPEC.md](docs/SPEC.md) for the full requirements and architecture.

## Stack

NestJS 12 (ESM, TypeScript 6) · Prisma + Postgres (Supabase) · Redis + BullMQ · Vitest.

## Local setup

```bash
pnpm install
cp .env.example .env        # fill in secrets as needed

docker compose up -d        # local Postgres + Redis

pnpm exec prisma migrate dev
pnpm exec prisma db seed

pnpm run start:dev
```

## Scripts

```bash
pnpm run start:dev   # watch mode
pnpm run build
pnpm run lint
pnpm run test         # unit tests
pnpm run test:e2e     # e2e tests (needs Postgres + Redis running)
```

Health check: `GET /health` — reports Postgres and Redis connectivity.
