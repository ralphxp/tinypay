-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "BvnVerificationStatus" AS ENUM ('pending', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('user', 'group', 'system');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('wallet', 'pool', 'psp_settlement', 'fees', 'revenue', 'suspense');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'frozen', 'closed');

-- CreateEnum
CREATE TYPE "CurrencyCode" AS ENUM ('NGN', 'USD');

-- CreateEnum
CREATE TYPE "JournalEntryKind" AS ENUM ('fund', 'transfer', 'contribute', 'disburse', 'withdraw', 'reversal', 'fee');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('pending', 'posted', 'reversed');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('fund', 'transfer', 'contribute', 'disburse', 'withdraw');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'completed', 'failed', 'reversed');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('telegram', 'whatsapp');

-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('admin', 'treasurer', 'member');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('active', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "PoolRoundStatus" AS ENUM ('open', 'closed', 'paid_out', 'cancelled');

-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('disburse', 'collect');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('pending', 'approved', 'rejected', 'executed', 'expired');

-- CreateEnum
CREATE TYPE "ProposalActionKind" AS ENUM ('paid', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "full_name" TEXT,
    "email" TEXT,
    "kyc_tier" INTEGER NOT NULL DEFAULT 1,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "user_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "security_q" TEXT,
    "security_a_hash" TEXT,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "device_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bvn_verifications" (
    "user_id" TEXT NOT NULL,
    "bvn_token" TEXT NOT NULL,
    "status" "BvnVerificationStatus" NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "bvn_verifications_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "resolved_name" TEXT NOT NULL,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "owner_type" "OwnerType" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "currency" "CurrencyCode" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "external_ref" TEXT NOT NULL,
    "kind" "JournalEntryKind" NOT NULL,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postings" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" "CurrencyCode" NOT NULL,
    "group_id" TEXT,
    "round_id" TEXT,
    "member_id" TEXT,

    CONSTRAINT "postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balances" (
    "account_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balances_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'pending',
    "psp_ref" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_tiers" (
    "tier" INTEGER NOT NULL,
    "single_txn_cap" BIGINT NOT NULL,
    "daily_cap" BIGINT NOT NULL,
    "balance_cap" BIGINT NOT NULL,

    CONSTRAINT "kyc_tiers_pkey" PRIMARY KEY ("tier")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "chat_ref" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "disburse_policy" JSONB NOT NULL,
    "status" "GroupStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id","user_id")
);

-- CreateTable
CREATE TABLE "mandates" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "cap_minor" BIGINT NOT NULL,
    "cadence" TEXT NOT NULL,
    "status" "MandateStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_rounds" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "target_minor" BIGINT NOT NULL,
    "payee_user_id" TEXT NOT NULL,
    "status" "PoolRoundStatus" NOT NULL DEFAULT 'open',
    "opens_at" TIMESTAMP(3) NOT NULL,
    "closes_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pool_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "dest" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "quorum" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'pending',
    "created_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_actions" (
    "proposal_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "ProposalActionKind" NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_actions_pkey" PRIMARY KEY ("proposal_id","user_id")
);

-- CreateTable
CREATE TABLE "banks" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],

    CONSTRAINT "banks_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "processed_webhook_events" (
    "event_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_user_id_idx" ON "webauthn_credentials"("user_id");

-- CreateIndex
CREATE INDEX "beneficiaries_user_id_idx" ON "beneficiaries"("user_id");

-- CreateIndex
CREATE INDEX "accounts_owner_type_owner_id_idx" ON "accounts"("owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_external_ref_key" ON "journal_entries"("external_ref");

-- CreateIndex
CREATE INDEX "postings_entry_id_idx" ON "postings"("entry_id");

-- CreateIndex
CREATE INDEX "postings_account_id_idx" ON "postings"("account_id");

-- CreateIndex
CREATE INDEX "postings_group_id_idx" ON "postings"("group_id");

-- CreateIndex
CREATE INDEX "postings_round_id_idx" ON "postings"("round_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_ref_key" ON "transactions"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_idempotency_key_key" ON "transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "transactions_user_id_idx" ON "transactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "groups_channel_chat_ref_key" ON "groups"("channel", "chat_ref");

-- CreateIndex
CREATE INDEX "mandates_group_id_idx" ON "mandates"("group_id");

-- CreateIndex
CREATE INDEX "mandates_user_id_idx" ON "mandates"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "pool_rounds_group_id_seq_key" ON "pool_rounds"("group_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_ref_key" ON "proposals"("ref");

-- CreateIndex
CREATE INDEX "proposals_group_id_idx" ON "proposals"("group_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_ref_idx" ON "audit_log"("entity", "ref");

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bvn_verifications" ADD CONSTRAINT "bvn_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "pool_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balances" ADD CONSTRAINT "balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_rounds" ADD CONSTRAINT "pool_rounds_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_rounds" ADD CONSTRAINT "pool_rounds_payee_user_id_fkey" FOREIGN KEY ("payee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_actions" ADD CONSTRAINT "proposal_actions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_actions" ADD CONSTRAINT "proposal_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
