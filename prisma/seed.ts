import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const KYC_TIERS = [
  { tier: 1, singleTxnCap: 50_000_00n, dailyCap: 200_000_00n, balanceCap: 300_000_00n },
  { tier: 2, singleTxnCap: 500_000_00n, dailyCap: 2_000_000_00n, balanceCap: 5_000_000_00n },
  { tier: 3, singleTxnCap: 10_000_000_00n, dailyCap: 50_000_000_00n, balanceCap: 0n },
];

const BANKS = [
  { code: '044', name: 'Access Bank', aliases: ['access'] },
  { code: '058', name: 'Guaranty Trust Bank', aliases: ['gtb', 'gtbank'] },
  { code: '057', name: 'Zenith Bank', aliases: ['zenith'] },
  { code: '033', name: 'United Bank for Africa', aliases: ['uba'] },
  { code: '011', name: 'First Bank of Nigeria', aliases: ['firstbank', 'fbn'] },
  { code: '232', name: 'Sterling Bank', aliases: ['sterling'] },
  { code: '999992', name: 'OPay', aliases: ['opay'] },
  { code: '999991', name: 'PalmPay', aliases: ['palmpay'] },
  { code: '50515', name: 'Moniepoint MFB', aliases: ['moniepoint'] },
  { code: '090267', name: 'Kuda Bank', aliases: ['kuda'] },
];

// System accounts backing platform-owned ledger legs. `ownerId` is a fixed
// well-known slug so app code can resolve them without a lookup table.
const SYSTEM_ACCOUNTS = [
  { ownerId: 'psp_settlement_ngn', kind: 'psp_settlement' as const, currency: 'NGN' as const },
  { ownerId: 'fees_ngn', kind: 'fees' as const, currency: 'NGN' as const },
  { ownerId: 'revenue_ngn', kind: 'revenue' as const, currency: 'NGN' as const },
  { ownerId: 'suspense_ngn', kind: 'suspense' as const, currency: 'NGN' as const },
];

async function main() {
  for (const tier of KYC_TIERS) {
    await prisma.kycTier.upsert({
      where: { tier: tier.tier },
      update: tier,
      create: tier,
    });
  }

  for (const bank of BANKS) {
    await prisma.bank.upsert({
      where: { code: bank.code },
      update: bank,
      create: bank,
    });
  }

  for (const account of SYSTEM_ACCOUNTS) {
    const existing = await prisma.account.findFirst({
      where: { ownerType: 'system', ownerId: account.ownerId },
    });
    if (existing) continue;

    await prisma.account.create({
      data: {
        ownerType: 'system',
        ownerId: account.ownerId,
        kind: account.kind,
        currency: account.currency,
        balance: { create: { amountMinor: 0n } },
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
