import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { TELEGRAM_BOT } from '../channels/telegram/telegram-bot.provider.js';

type ComponentStatus = 'up' | 'down';
/** 'not_configured' never counts against overall readiness — the bot is an
 * optional integration in local dev/CI, where TELEGRAM_BOT_TOKEN is unset. */
type TelegramStatus = ComponentStatus | 'not_configured';

/** Just enough of grammy's Bot surface for a readiness check — kept local
 * rather than importing grammy's own type, so no file outside
 * modules/channels/telegram ever imports the Telegram SDK (grep-able). */
interface BotReadinessHandle {
  isInited(): boolean;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TELEGRAM_BOT) private readonly bot: BotReadinessHandle | undefined,
  ) {}

  @Get()
  async check(): Promise<{ status: 'ok' | 'error'; db: ComponentStatus; telegram: TelegramStatus }> {
    const dbResult = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`]);

    const db: ComponentStatus = dbResult[0].status === 'fulfilled' ? 'up' : 'down';
    // TelegramBotInitializer (telegram-core.module.ts) calls bot.init() at
    // boot, which only completes (isInited() true) on a successful getMe()
    // call — a configured-but-invalid token surfaces here as 'down',
    // distinct from the bot simply not being configured at all.
    const telegram: TelegramStatus = !this.bot ? 'not_configured' : this.bot.isInited() ? 'up' : 'down';

    const okOverall = db === 'up' && telegram !== 'down';
    const status: 'ok' | 'error' = okOverall ? 'ok' : 'error';

    const body = { status, db, telegram };
    if (status === 'error') {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
