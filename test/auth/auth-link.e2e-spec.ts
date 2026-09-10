import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { RedisModule } from '../../src/infra/redis/redis.module.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { AuthLinkService } from '../../src/modules/auth/auth-link.service.js';
import { PinService } from '../../src/modules/auth/pin.service.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';

const rawPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

describe('Auth link -> set PIN (e2e)', () => {
  let app: INestApplication<App>;
  let authLinks: AuthLinkService;
  let pin: PinService;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule, RedisModule, AuthModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    authLinks = moduleFixture.get(AuthLinkService);
    pin = moduleFixture.get(PinService);

    const user = await rawPrisma.user.create({
      data: { phone: `+234${randomUUID().replace(/-/g, '').slice(0, 10)}` },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await app.close();
    await rawPrisma.$disconnect();
  });

  it('sets the PIN through a valid single-use link', async () => {
    const token = authLinks.create(userId, 'set_pin');

    await request(app.getHttpServer())
      .post(`/auth/link/${token}/pin`)
      .send({ pin: '1234' })
      .expect(201);

    expect(await pin.verifyPin(userId, '1234')).toBe(true);
  });

  it('rejects reuse of the same link', async () => {
    const token = authLinks.create(userId, 'set_pin');

    await request(app.getHttpServer()).post(`/auth/link/${token}/pin`).send({ pin: '1111' });

    await request(app.getHttpServer())
      .post(`/auth/link/${token}/pin`)
      .send({ pin: '2222' })
      .expect(422);
  });

  it('rejects a malformed PIN', async () => {
    const token = authLinks.create(userId, 'set_pin');

    await request(app.getHttpServer())
      .post(`/auth/link/${token}/pin`)
      .send({ pin: 'abcd' })
      .expect(400);
  });
});
