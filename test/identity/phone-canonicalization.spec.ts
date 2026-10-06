import { randomInt } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { UserService } from '../../src/modules/identity/user.service.js';

const rawPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function freshLocalPhone(): string {
  return `0803${randomInt(1_000_000, 9_999_999)}`;
}

describe('UserService: canonical phone handling', () => {
  let moduleRef: TestingModule;
  let users: UserService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule],
      providers: [UserService],
    }).compile();
    users = moduleRef.get(UserService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await rawPrisma.$disconnect();
  });

  it('0803…, +234803…, and 234803… all resolve to the same user regardless of input form', async () => {
    const local = freshLocalPhone(); // e.g. 08031234567
    const e164 = `+234${local.slice(1)}`;
    const noPlus = `234${local.slice(1)}`;

    const created = await users.create({ phone: local });

    const viaLocal = await users.findByPhone(local);
    const viaE164 = await users.findByPhone(e164);
    const viaNoPlus = await users.findByPhone(noPlus);

    expect(viaLocal?.id).toBe(created.id);
    expect(viaE164?.id).toBe(created.id);
    expect(viaNoPlus?.id).toBe(created.id);
    expect(viaLocal?.phone).toBe(e164); // stored canonical form is always E.164
    expect(created.phone).toBe(e164);
  });

  it('finding by one form after creating with another never creates a second account row', async () => {
    const local = freshLocalPhone();
    const e164 = `+234${local.slice(1)}`;

    const created = await users.findOrCreateByPhone(local);
    const foundAgain = await users.findOrCreateByPhone(e164); // same person, different input form

    expect(foundAgain.id).toBe(created.id);

    const rowCount = await rawPrisma.user.count({ where: { phone: e164 } });
    expect(rowCount).toBe(1);
  });
});
