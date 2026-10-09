import { Body, Controller, Header, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '../../../config/config.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { validateTwilioSignature } from './twilio-signature.js';
import { WhatsAppAdapter } from './whatsapp.adapter.js';

const TWIML_ACK = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppAdapter,
  ) {}

  @Post()
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async handle(
    @Headers('x-twilio-signature') signature: string | undefined,
    @Body() body: Record<string, string>,
  ): Promise<string> {
    const authToken = this.config.get('TWILIO_AUTH_TOKEN');
    if (authToken) {
      const url = new URL('/webhooks/whatsapp', this.config.get('APP_BASE_URL')).toString();
      if (!validateTwilioSignature(authToken, url, body, signature)) {
        throw new UnauthorizedException('Invalid Twilio signature');
      }
    }

    // Twilio retries a webhook delivery that doesn't get a timely response —
    // same double-processing risk (and fix) as TelegramWebhookController.
    if (body.MessageSid) {
      const eventId = `whatsapp:${body.MessageSid}`;
      try {
        await this.prisma.processedWebhookEvent.create({ data: { eventId, provider: 'whatsapp' } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return TWIML_ACK;
        }
        throw err;
      }
    }

    await this.whatsapp.handleIncoming(body);
    return TWIML_ACK;
  }
}
