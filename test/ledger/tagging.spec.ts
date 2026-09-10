import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { WalletModule } from '../../src/modules/wallet/wallet.module.js';
import { LedgerService } from '../../src/modules/wallet/ledger.service.js';
import { contribution, funding } from '../../src/modules/wallet/ledger.postings.js';
import { LedgerTestFactory, SETTLEMENT_ACCT } from './ledger-test.factory.js';

describe('Ledger: tagging (pool contributions)', () => {
  let moduleRef: TestingModule;
  let ledger: LedgerService;
  const factory = new LedgerTestFactory();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule, WalletModule],
    }).compile();
    ledger = moduleRef.get(LedgerService);
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await factory.close();
  });

  it('tags both legs of a contribution, and pot total + per-member share derive from SUM over postings', async () => {
    const admin = await factory.createUser();
    const groupId = await factory.createGroup(admin);
    const pool = factory.poolRef(groupId);

    const memberA = await factory.createUser();
    const memberB = await factory.createUser();
    await factory.seedBalance(factory.walletRef(memberA), 10_000n);
    await factory.seedBalance(factory.walletRef(memberB), 10_000n);

    const contributionA = await ledger.postEntry({
      externalRef: randomUUID(),
      kind: 'contribute',
      legs: contribution(factory.walletRef(memberA), pool, 2_000n, {
        groupId,
        memberId: memberA,
      }),
    });
    const contributionB = await ledger.postEntry({
      externalRef: randomUUID(),
      kind: 'contribute',
      legs: contribution(factory.walletRef(memberB), pool, 3_000n, {
        groupId,
        memberId: memberB,
      }),
    });

    // Both legs of each contribution carry the tags, not just the pool-side leg.
    for (const { postings } of [contributionA, contributionB]) {
      for (const posting of postings) {
        expect(posting.groupId).toBe(groupId);
      }
    }

    const poolAccount = await factory.prisma.account.findFirstOrThrow({
      where: { ownerType: 'group', ownerId: groupId, kind: 'pool' },
    });

    const potTotal = await factory.prisma.posting.aggregate({
      where: { accountId: poolAccount.id, groupId },
      _sum: { amountMinor: true },
    });
    expect(potTotal._sum.amountMinor).toBe(5_000n);

    const memberAShare = await factory.prisma.posting.aggregate({
      where: { accountId: poolAccount.id, groupId, memberId: memberA },
      _sum: { amountMinor: true },
    });
    expect(memberAShare._sum.amountMinor).toBe(2_000n);

    const memberBShare = await factory.prisma.posting.aggregate({
      where: { accountId: poolAccount.id, groupId, memberId: memberB },
      _sum: { amountMinor: true },
    });
    expect(memberBShare._sum.amountMinor).toBe(3_000n);

    // Sanity: an untagged, unrelated movement never leaks into the pot total.
    await ledger.postEntry({
      externalRef: randomUUID(),
      kind: 'fund',
      legs: funding(factory.walletRef(memberA), SETTLEMENT_ACCT, 999n),
    });
    const potTotalAfterUnrelatedFunding = await factory.prisma.posting.aggregate({
      where: { accountId: poolAccount.id, groupId },
      _sum: { amountMinor: true },
    });
    expect(potTotalAfterUnrelatedFunding._sum.amountMinor).toBe(5_000n);
  });
});
