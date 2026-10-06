> **Superseded.** The product was narrowed to: Telegram/WhatsApp bot, fund via
> Paystack Checkout, buy airtime/data via Bigisub, balance + history. No
> transfers, no group-finance/pools, no WebAuthn/PIN, no LLM NLU, no
> Redis/BullMQ. See [README.md](../README.md) for the current scope — this
> document is kept only as historical context for the broader design this
> was scoped down from.

# TinyPay — Backend Requirements & Foundation Spec

**Status:** draft v0.1 · **Owner:** Codizium Integrated Services
**Scope:** server-side only (no UI). Chat-native wallet + group-finance agent over Telegram and WhatsApp.

---

## 1. Product definition & scope

TinyPay is a chat-native financial agent with two contexts sharing one backend:

- **Personal (wallet):** a user funds a balance, transfers, and (later) pays bills — invoked in a 1:1 DM.
- **Group (treasurer/accountant):** a chat maps to a pooled group account for contributions (ajo/esusu/dues), with governed disbursement — invoked in a group (Telegram) or via a link-bridge + DM fan-out (WhatsApp).

**Wedge / differentiation:** group-finance done *correctly* — an auditable double-entry ledger, multi-sig pot outflow, and ledger-enforced KYC tiers. The reference product (Laskad) already has Cloud API + Flows + WebAuthn + tiered KYC; we do not compete on having the feature, we compete on the invisible correctness layer.

### Scope phasing

| Phase | Contents |
|---|---|
| **P0 — Foundation** | Repo, config, DB + migrations, Redis, queue, health, CI, base conventions |
| **P1 — MVP** | Identity + enrollment, double-entry ledger, Telegram adapter, Paystack (DVA funding → balance → withdrawal), FSM, wake-word + grammar parse, PIN via web/WebAuthn |
| **P2 — WhatsApp** | Cloud API adapter, WhatsApp Flows (PIN/bank/KYC), WebAuthn deep-link, web onboarding fallback |
| **P3 — Group finance (the wedge)** | Groups, membership/roles, mandates, pool rounds/rotation, disbursement saga (propose→approve→execute), M-of-N |
| **P4 — Intelligence & breadth** | LLM NLU fallback (Pidgin/local languages), Stripe (USD/diaspora), VAS (airtime/data/bills) |

---

## 2. Guiding principles (non-negotiable invariants)

These constrain every module. Violating one is a defect, not a tradeoff.

1. **The ledger is the source of truth for money.** The FSM/session is transient and non-authoritative; losing Redis mid-flow loses no money.
2. **Double-entry, always balanced.** Every money movement is a set of postings summing to zero. Money is integer minor units (kobo/cents). No floats. Currency stamped per account.
3. **AI proposes, deterministic code disposes.** The LLM/NLU is an input transducer only — it never moves money, authorizes, computes an executing amount, or calls a tool.
4. **Context binds source account *before* authorization.** Same verb means different money by surface; permission depends on the resolved source. Inbound-to-pot = any enrolled member; outbound-from-pot = admin (M-of-N above threshold).
5. **Consent per debit.** No wallet is debited without that member's own authenticated command. "Collect from everyone" creates requests, not pulls. Recurring debits require an explicit revocable mandate.
6. **Enrollment ≠ transaction auth.** Being a known user is a front gate; every debit additionally requires confirm + second factor.
7. **Secrets never touch chat.** PIN/BVN/password/OTP go through WhatsApp Flows / WebAuthn / web — never as chat messages. Account numbers masked in group output.
8. **Idempotency on every money mutation and every inbound webhook.** External refs and event ids dedupe; PSPs and queues retry.
9. **Grammar is the floor.** Core money verbs (`transfer`/`contribute`/`disburse`) resolve deterministically so an LLM outage or spend cap can never break a payment.
10. **KYC tiers enforced in the ledger at debit time**, not in copy.

---

## 3. Tech stack & tooling

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 | ESM-first |
| Language | TypeScript 6 (strict) | `nodenext` module resolution, `.js` import extensions |
| Framework | NestJS 12 | ESM, modular, DI, guards/interceptors — **decided 2026-09-08:** keep latest CLI scaffold (ESM/TS6/Vitest/oxlint) rather than pinning to classic Nest 10/CJS/Jest |
| DB | Supabase Postgres | treated as managed Postgres |
| DB access | **Prisma** (default) | interactive TX + `$queryRaw` for `FOR UPDATE`; Drizzle is the alternative — *open decision* |
| Cache / state / queue | Redis (Upstash or self-host) | FSM state, idempotency, BullMQ |
| Queue | `@nestjs/bullmq` | async webhook processing, sagas, fan-out |
| Validation | `zod` (+ `class-validator` for DTOs) | NLU output, config, request bodies |
| Password hash | `argon2id` | |
| WebAuthn | `@simplewebauthn/server` | device biometric auth |
| Telegram | `grammy` or `telegraf` | native group support |
| WhatsApp | Cloud API (direct `fetch` or BSP SDK) | Flows, templates |
| LLM | hosted small model per-call | provider TBD — *open decision* |
| Package manager | pnpm | |
| Lint/format | oxlint + Prettier | scaffold default; swap to ESLint later if oxlint's Nest/decorator coverage proves insufficient |
| Tests | Vitest (unit) + supertest (e2e) | ledger + resolver + NLU eval sets are mandatory |
| Deploy | TBD (Fly / Railway / Render / self-host VPS) | *open decision*; webhooks need public HTTPS |

---

## 4. Repository / folder organization

Single NestJS application (monorepo/Nx deferred). Feature modules depend on **ports**, never on concrete providers.

```
tinypay-backend/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                      # banks, kyc_tiers, system accounts
├── test/
│   ├── ledger/                      # balance invariants, concurrency
│   ├── resolver/                    # source/dest/role matrix
│   └── nlu/                         # NG-phrasing eval + injection red-team
├── src/
│   ├── main.ts                      # bootstrap; rawBody:true for webhooks
│   ├── app.module.ts
│   │
│   ├── config/
│   │   ├── config.module.ts
│   │   ├── config.schema.ts         # zod-validated env
│   │   └── config.service.ts
│   │
│   ├── common/
│   │   ├── guards/
│   │   │   ├── enrollment.guard.ts      # known user? else onboarding link
│   │   │   ├── auth.guard.ts            # PIN / WebAuthn assertion present
│   │   │   ├── roles.guard.ts           # group role checks
│   │   │   └── throttler.guard.ts       # per user+channel
│   │   ├── interceptors/
│   │   │   ├── idempotency.interceptor.ts
│   │   │   └── logging.interceptor.ts   # correlation id
│   │   ├── filters/
│   │   │   ├── all-exceptions.filter.ts
│   │   │   └── step-error.filter.ts     # FSM re-prompt errors
│   │   ├── decorators/                  # @CurrentUser, @Idempotent
│   │   ├── money/
│   │   │   └── money.ts                 # Money VO (bigint minor units + currency)
│   │   └── errors/                      # typed domain errors
│   │
│   ├── infra/
│   │   ├── database/
│   │   │   ├── prisma.module.ts
│   │   │   └── prisma.service.ts        # + withTransaction() helper
│   │   ├── redis/
│   │   │   └── redis.module.ts
│   │   └── queue/
│   │       ├── queue.module.ts
│   │       └── processors/
│   │           ├── settlement.processor.ts   # inbound webhook → ledger
│   │           ├── payout.processor.ts       # outbound transfer execution
│   │           ├── saga.processor.ts         # proposal lifecycle/expiry
│   │           └── notify.processor.ts       # fan-out / templates
│   │
│   ├── modules/
│   │   ├── identity/                 # users, phone-as-key, KYC tiers, BVN
│   │   │   ├── identity.module.ts
│   │   │   ├── user.service.ts
│   │   │   ├── enrollment.service.ts
│   │   │   ├── kyc.service.ts           # tier state, BVN verify+tokenize
│   │   │   └── dto/
│   │   ├── auth/                     # credentials + second factor
│   │   │   ├── auth.module.ts
│   │   │   ├── pin.service.ts
│   │   │   ├── webauthn.service.ts      # register + assert ceremonies
│   │   │   ├── recovery.service.ts      # OTP; device re-enrollment
│   │   │   └── auth-link.service.ts     # short-lived signed action links
│   │   ├── wallet/                  # accounts + ledger
│   │   │   ├── wallet.module.ts
│   │   │   ├── ledger.service.ts        # postEntry() — the core
│   │   │   ├── balance.service.ts
│   │   │   ├── account.service.ts
│   │   │   └── limits.service.ts        # tier cap enforcement at post time
│   │   ├── groups/
│   │   │   ├── groups.module.ts
│   │   │   ├── group.service.ts
│   │   │   ├── membership.service.ts    # roles
│   │   │   └── mandate.service.ts       # capture, cap, revoke
│   │   ├── pools/                   # the multi-party saga
│   │   │   ├── pools.module.ts
│   │   │   ├── round.service.ts         # rotation (ajo/esusu)
│   │   │   ├── proposal.service.ts      # propose/approve/execute/expire
│   │   │   └── policy.service.ts        # M-of-N, thresholds, quorum
│   │   ├── payments/                # PSP orchestration
│   │   │   ├── payments.module.ts
│   │   │   ├── psp.port.ts
│   │   │   ├── payments.orchestrator.ts # route by currency
│   │   │   ├── paystack/                # DVA, charge, resolve, transfer
│   │   │   └── stripe/                  # PaymentIntents, Connect
│   │   ├── resolver/                # KEYSTONE
│   │   │   └── source-account.resolver.ts  # surface+verb → source→dest→role/auth
│   │   ├── conversation/           # FSM
│   │   │   ├── conversation.module.ts
│   │   │   ├── conversation.service.ts  # advance() loop
│   │   │   ├── state.store.ts           # Redis lock + optimistic version
│   │   │   ├── flow.registry.ts
│   │   │   └── flows/                   # transfer, contribute, disburse, fund…
│   │   ├── nlu/                     # input transducer
│   │   │   ├── nlu.module.ts
│   │   │   ├── nlu.service.ts           # grammar-first, LLM fallback
│   │   │   ├── grammar.ts               # deterministic patterns
│   │   │   ├── llm.classifier.ts        # bounded JSON, temp 0
│   │   │   ├── normalizer.ts            # amount words, bank alias, NUBAN
│   │   │   └── nlu.cache.ts
│   │   ├── channels/               # transport adapters
│   │   │   ├── channels.module.ts
│   │   │   ├── channel.port.ts          # supportsGroupSurface, fanOut, invite
│   │   │   ├── telegram/                # native group member
│   │   │   ├── whatsapp/                # DM + link-bridge; templates; Flows
│   │   │   └── renderers/               # shared message envelope
│   │   ├── flows/                  # WhatsApp Flows + web fallback
│   │   │   ├── flows.controller.ts      # Flow data-exchange endpoints
│   │   │   └── web-onboarding.controller.ts  # phone-keyed fallback
│   │   ├── webhooks/
│   │   │   ├── paystack.controller.ts   # HMAC-SHA512 raw body
│   │   │   ├── stripe.controller.ts     # constructEvent
│   │   │   └── whatsapp.controller.ts   # verify + inbound events
│   │   ├── notifications/
│   │   │   └── notifications.service.ts # group post vs DM fan-out
│   │   ├── vas/                    # P4: airtime, data, bills
│   │   └── audit/
│   │       └── audit.service.ts         # append-only log
│   │
│   └── shared/
│       ├── types/                   # Intent, Slots, Surface, AccountKind…
│       ├── constants/
│       └── utils/
├── .env.example
├── docker-compose.yml               # local Postgres + Redis
└── README.md
```

---

## 5. Domain model

Money is `BIGINT` minor units everywhere. All timestamps UTC. Soft-delete via `status` where relevant. FSM sessions live in **Redis**, not Postgres.

### Identity & auth
- **users** — `id, phone (unique, join key), full_name, email, kyc_tier (default 1), status, created_at`
- **credentials** — `user_id, password_hash (argon2id), security_q, security_a_hash`
- **webauthn_credentials** — `id, user_id, credential_id, public_key, counter, device_label, created_at`
- **bvn_verifications** — `user_id, bvn_token, status, verified_at` *(no raw BVN stored)*
- **beneficiaries** — `user_id, alias, account, bank_code, resolved_name`

### Ledger (core)
- **accounts** — `id, owner_type (user|group|system), owner_id, kind (wallet|pool|psp_settlement|fees|revenue|suspense), currency, status`
- **journal_entries** — `id, external_ref (unique), kind, status, created_at`
- **postings** — `id, entry_id, account_id, amount_minor, currency, group_id?, round_id?, member_id?`
  - **Invariant:** `SUM(amount_minor) = 0` per `entry_id`, enforced inside the transaction (trigger or app-level check before commit).
- **balances** — `account_id, amount_minor, updated_at` *(cache; mutated only under `SELECT … FOR UPDATE` in the same TX as its postings)*
- **transactions** — `id, ref (unique), user_id, type, amount_minor, status, psp_ref, idempotency_key` *(user-facing money-move record; links to a journal_entry)*
- **kyc_tiers** — `tier, single_txn_cap, daily_cap, balance_cap` *(config/seed)*

### Groups & pools
- **groups** — `id, chat_ref, channel, name, created_by, disburse_policy (jsonb), status`
- **group_members** — `group_id, user_id, role (admin|treasurer|member), joined_at`
- **mandates** — `id, group_id, user_id, cap_minor, cadence, status, created_at`
- **pool_rounds** — `id, group_id, seq, target_minor, payee_user_id, status, opens_at, closes_at`
- **proposals** — `id, group_id, kind (disburse|collect), amount_minor, dest, ref, quorum, status, created_by, expires_at`
- **proposal_actions** — `proposal_id, user_id, kind (paid|approved|rejected), decided_at`

### Reference & control
- **banks** — `code, name, aliases[]` *(seed; alias resolution incl. fintech wallets)*
- **processed_webhook_events** — `event_id (pk), provider, processed_at`
- **idempotency_keys** — `key (pk), scope, response, created_at`
- **audit_log** — append-only: `actor, action, entity, ref, at`

Derived, never stored as truth: pot total = `SUM(postings WHERE account=pool AND group_id=?)`; per-member share = same filtered by `member_id`.

---

## 6. Module functional requirements (summary)

- **identity** — resolve/create user by phone; enrollment check as front gate; KYC tier state machine (Tier 1 default, BVN unlocks higher); BVN verify-and-tokenize, never raw.
- **auth** — PIN (argon2id, separate from any password); WebAuthn register/assert; short-lived, single-use, action-bound signed auth links showing what's authorized; OTP recovery; device re-enrollment path (treated as high-risk).
- **wallet** — `postEntry()` in one TX (balanced postings, `FOR UPDATE` on cached balances, external_ref idempotent); tier-cap check at post time (reject on breach); reversing entries for corrections.
- **groups** — group CRUD bound to chat_ref; roles; mandate capture/cap/revoke.
- **pools** — rounds + rotation; proposal saga (propose→fan-out→collect→quorum→execute→receipt); expiry → refund-or-hold per policy.
- **payments** — `PspPort` (charge, resolveRecipient, transfer, createDVA); orchestrator routes by currency (NGN→Paystack, USD→Stripe); resolve-before-payout with failure/retry/fallback handling.
- **resolver** — the keystone guard: `(surface, verb, actor, target) → {source, dest, requiredRole, requiredAuth}`. Runs before permission checks and before the FSM.
- **conversation** — `advance()` with per-session Redis lock; global interrupts (cancel/menu/back/help) beat step routing; idempotency ref minted at confirm; `executing` state guarded against double-execution.
- **nlu** — grammar-first; LLM fallback with 2s timeout → `unknown`; bounded schema, intent-clamped; normalizer owns canonicalization; cache; spend cap → degrade to grammar+menu.
- **channels** — `ChannelPort.supportsGroupSurface`; Telegram native group; WhatsApp DM + invite-link + DM fan-out; shared renderer/envelope; mask account numbers in group output.
- **webhooks** — verify signature on raw body → dedupe → enqueue → 200 immediately; all money work in processors.
- **notifications** — group-post vs DM fan-out; WhatsApp templates for sends outside the 24h window.

---

## 7. Configuration & environment

Validated by `config.schema.ts` (zod) at boot; fail fast on missing/invalid.

```
# Core
NODE_ENV, PORT, APP_BASE_URL
DATABASE_URL                      # Supabase pooler (transaction mode) or direct 5432
REDIS_URL

# Security
JWT_SECRET / SIGNING_KEY          # auth-link signing
ENCRYPTION_KEY                    # PII at rest
WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, WEBAUTHN_ORIGIN

# Paystack
PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY, PAYSTACK_WEBHOOK_SECRET

# Stripe (P4)
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

# Telegram
TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET

# WhatsApp Cloud API
WA_PHONE_NUMBER_ID, WA_BUSINESS_ACCOUNT_ID, WA_ACCESS_TOKEN,
WA_WEBHOOK_VERIFY_TOKEN, WA_APP_SECRET, WA_FLOW_ENCRYPTION_KEY

# LLM
LLM_PROVIDER, LLM_API_KEY, LLM_MODEL, LLM_MONTHLY_CAP_USD

# KYC / BVN
BVN_PROVIDER, BVN_API_KEY
```

---

## 8. Non-functional requirements

**Security**
- argon2id for PIN + password; PII encrypted at rest; secrets in env/vault, never in code, logs, or chat.
- Raw-body preserved on all webhook routes for signature verification.
- Per user+channel rate limiting; auth links short-TTL/single-use/action-bound and phishing-hardened (show what's approved).
- Prompt-injection defenses: user text is data not instructions; only addressed utterance reaches the LLM; output schema-validated + intent-clamped; LLM never sees/emits auth material.

**Compliance**
- CBN 3-tier KYC enforced at the ledger (caps by tier); BVN-optional ⇒ Tier-1 limits.
- NDPR: BVN tokenized (no raw), DPA with LLM provider, PII redacted from prompts/logs, defined retention.
- AML monitoring specifically on pooled inflows/outflows; per-group balance segregation provable from the ledger.
- Custody via licensed partner or own licence *(gate before launch — see open decisions)*.

**Reliability**
- Idempotency everywhere money moves (external refs, event ids, queue job keys).
- Webhooks: return 200 fast, process in idempotent queue consumers (at-least-once).
- All money mutations transactional with row locks; corrections via reversing entries; never mutate history.
- Alert on any ledger imbalance (`SUM(postings) ≠ 0` for an entry) — treat as sev-1.

**Observability**
- Structured logging with correlation ids across channel → FSM → ledger → PSP.
- Append-only audit log for every state change; per-group statements derivable.

**Performance**
- FSM in Redis; grammar-first NLU (LLM on <~30% of traffic, shrinking as patterns promote to grammar); NLU cache.

---

## 9. Cross-cutting conventions

- **Ports over concretes:** business modules import interfaces (`ChannelPort`, `PspPort`, `LedgerService`), never `paystack`/`grammy` directly.
- **Errors:** typed domain errors; `StepError` re-prompts the FSM step; `LockError`/tier breach abort with a user-safe message.
- **DTOs validated** at every boundary; NLU output validated separately (untrusted).
- **Naming:** money fields `*_minor` (bigint); refs are ULIDs; account `kind`/`owner_type` enums fixed in `shared/types`.
- **Testing gates:** ledger invariants + concurrency, resolver source/dest/role matrix, and NLU accuracy (NG-phrasing eval) + injection red-team must pass in CI. Grammar remains the floor for money verbs.

---

## 10. Build order / milestones

1. **P0** — repo, pnpm, Nest bootstrap (`rawBody`), config+zod, Prisma+Supabase, Redis, BullMQ, Docker compose, health endpoint, CI, base guards/interceptors/filters, `Money` VO.
2. **P1 (MVP)** — `identity`+enrollment guard → `wallet`/ledger (`postEntry`, balances, tier caps) → `payments/paystack` (DVA, resolve, transfer) → `webhooks/paystack` → `channels/telegram` → `conversation` FSM + `nlu` grammar + `resolver` → flows: fund (DVA), balance, transfer/withdraw. Auth via web/WebAuthn link.
3. **P2** — `channels/whatsapp` + `flows` (PIN/bank/KYC) + `auth/webauthn` deep-link + web-onboarding fallback.
4. **P3** — `groups` + `pools` (rounds, rotation, proposal saga, M-of-N) + `mandate`.
5. **P4** — `nlu/llm.classifier` (Pidgin/local) + `payments/stripe` + `vas`.

Start P1 at the **`resolver`** — it encodes the source/dest/role table every later module depends on — then the **ledger**, then wire Telegram + Paystack around them.

---

## 11. Open decisions (need your call)

- [ ] **ORM:** Prisma (default) vs Drizzle vs TypeORM.
- [ ] **Custody model & partner:** licensed partner (which MFB/PSSP?) vs pursue own licence — gates launch timeline.
- [ ] **MVP channel:** confirm Telegram-first (recommended — only channel with native group support).
- [ ] **VAS breadth:** build airtime/data/bills (match Laskad) or stay deep on group-finance only?
- [ ] **LLM provider:** which hosted small model (per the cost discussion) + monthly cap value.
- [ ] **Deployment target:** Fly / Railway / Render / self-host VPS (Fedora dev environment).
- [ ] **Repo/package name:** e.g. `@codizium/tinypay-backend`; GitHub under `ralphxp`/org.
- [ ] **Group↔chat binding on WhatsApp:** confirm logical-group + invite-link model (bot not in WA group).
- [ ] **Monorepo (Nx) later?** default is single app for now.
