import { Body, Controller, Header, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';
import { validateTwilioSignature } from './twilio-signature.js';
import { WhatsAppAdapter } from './whatsapp.adapter.js';

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly config: ConfigService,
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

    await this.whatsapp.handleIncoming(body);
    // Twilio expects TwiML (even empty) for a 200 on this webhook.
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }
}
