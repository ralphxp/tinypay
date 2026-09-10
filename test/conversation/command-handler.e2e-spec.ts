import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { RedisModule } from '../../src/infra/redis/redis.module.js';
import { ConversationModule } from '../../src/modules/conversation/conversation.module.js';
import { CommandHandlerService } from '../../src/modules/conversation/command-handler.service.js';
import { LedgerService } from '../../src/modules/wallet/ledger.service.js';
import { PinService } from '../../src/modules/auth/pin.service.js';

const rawPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function randomDigits(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

async function createTestUser(): Promise<string> {
  const user = await rawPrisma.user.create({
    data: { phone: `+234${randomDigits(10)}` },
  });
  return user.id;
}

describe('CommandHandlerService (e2e)', () => {
  let moduleRef: TestingModule;
  let conversation: CommandHandlerService;
  let ledger: LedgerService;
  let pin: PinService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule, RedisModule, ConversationModule],
    }).compile();

    conversation = moduleRef.get(CommandHandlerService);
    ledger = moduleRef.get(LedgerService);
    pin = moduleRef.get(PinService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await rawPrisma.$disconnect();
  });

  it('reports a zero balance for a brand-new user', async () => {
    const userId = await createTestUser();
    const reply = await conversation.handleMessage({
      chatRef: randomUUID(),
      userId,
      text: 'balance',
    });
    expect(reply).toContain('₦0.00');
  });

  it('reports the correct balance after a funded wallet', async () => {
    const userId = await createTestUser();
    await ledger.postEntry({
      externalRef: randomUUID(),
      kind: 'fund',
      legs: [
        {
          accountRef: { ownerType: 'system', ownerId: 'psp_settlement_ngn', kind: 'psp_settlement' },
          amountMinor: -150_000n,
        },
        { accountRef: { ownerType: 'user', ownerId: userId, kind: 'wallet' }, amountMinor: 150_000n },
      ],
    });

    const reply = await conversation.handleMessage({ chatRef: randomUUID(), userId, text: 'bal' });
    expect(reply).toContain('₦1,500.00');
  });

  it('shows the help menu for unrecognized text', async () => {
    const userId = await createTestUser();
    const reply = await conversation.handleMessage({
      chatRef: randomUUID(),
      userId,
      text: 'how far my guy',
    });
    expect(reply).toContain("didn't catch that");
  });

  it('prompts for PIN setup before allowing a transfer', async () => {
    const userId = await createTestUser();
    const recipientId = await createTestUser();
    const recipient = await rawPrisma.user.findUniqueOrThrow({ where: { id: recipientId } });

    const reply = await conversation.handleMessage({
      chatRef: randomUUID(),
      userId,
      text: `transfer 1000 to ${recipient.phone}`,
    });

    expect(reply).toContain('set a PIN');
    expect(reply).toContain('/auth/link/');
  });

  it('returns a confirm link for a valid internal transfer once enrolled', async () => {
    const userId = await createTestUser();
    await pin.setPin(userId, '1234');
    const recipientId = await createTestUser();
    const recipient = await rawPrisma.user.findUniqueOrThrow({ where: { id: recipientId } });

    const reply = await conversation.handleMessage({
      chatRef: randomUUID(),
      userId,
      text: `send 1000 to ${recipient.phone}`,
    });

    expect(reply).toContain('Confirm: send ₦1,000.00');
    expect(reply).toContain('/auth/link/');
  });
});
