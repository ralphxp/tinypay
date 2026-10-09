# TinyPay Backend

A Telegram + WhatsApp bot wallet: fund via Paystack, buy airtime and data. Money itself lives in Paystack — this app is bookkeeping (balance + transaction history) and the airtime/data purchase integration (Bigisub).

## Stack

NestJS 12 (ESM, TypeScript 6) · Prisma + Supabase Postgres · Vitest. No Redis/queue — the conversation FSM's session state lives in Postgres, and webhook-driven work (crediting a wallet, sending a Telegram notification) is fast enough to run inline.

## Local setup

```bash
pnpm install
cp .env.example .env   # fill in Supabase connection strings + provider keys

pnpm exec prisma migrate dev
pnpm run start:dev
```

`DATABASE_URL`/`DIRECT_URL` point at a Supabase project (Project Settings → Database → Connection string). Use the Session pooler, not the direct connection, if your network lacks IPv6 — Supabase's direct host is IPv6-only.

## Scripts

```bash
pnpm run start:dev            # watch mode
pnpm run build
pnpm run lint
pnpm run test                  # unit tests (hits the real Supabase DB)
pnpm run test:e2e              # e2e tests
pnpm run prisma:migrate        # migrate dev, via DATABASE_URL
pnpm run prisma:migrate:direct # migrate dev, via DIRECT_URL (use if DATABASE_URL is a transaction-mode pooler)
```

Health check: `GET /health` — reports Postgres and Telegram-bot readiness.

### WhatsApp

Via Twilio (as the BSP), not Meta's Cloud API directly — set `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_WHATSAPP_NUMBER`, point the sandbox's "when a message comes in" webhook at `https://<your-url>/webhooks/whatsapp`. No separate enrollment/linking step like Telegram needs (Twilio's `From` is already a verified phone), and no native tappable buttons on the sandbox — every choice renders as a numbered text list, and a bare number reply is translated back to the tapped value (see `WhatsAppAdapter.resolveNumberedReply`).

## Scope

- Create a wallet (implicit — one per enrolled user)
- Fund it via a Paystack Checkout link (`charge.success` webhook credits the balance)
- Buy airtime or a data bundle (debited from the wallet, purchased via Bigisub)
- Check balance / transaction history

No P2P transfers, no group-finance pools, no WebAuthn/PIN flows, no LLM NLU — see git history for the earlier, broader-scoped build this was narrowed down from.

### Known gap

A Bigisub purchase can come back `pending` (still processing with the network) rather than an immediate success/fail — there's no webhook for the final outcome, only a requery endpoint (`BigisubProvider.requeryTransaction`) nothing polls yet. The wallet transaction just stays `pending`; the user finds out via a later `history` check.

## Deploying

See [DEPLOY.md](DEPLOY.md) — Render (current, no card needed) or AWS EC2 (later, if needed).
