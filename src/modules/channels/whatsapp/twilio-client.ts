import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';

const BASE_URL = 'https://api.twilio.com/2010-04-01';

/**
 * The only place an HTTP call to Twilio is ever made. Twilio uses Basic Auth
 * (Account SID as username, Auth Token as password) and a classic
 * form-urlencoded body for its Messages resource — unlike Paystack/Bigisub,
 * there's no JSON envelope to unwrap.
 */
@Injectable()
export class TwilioClient {
  private readonly logger = new Logger(TwilioClient.name);

  constructor(private readonly config: ConfigService) {}

  /** `to`/`from` must already be in "whatsapp:+234..." form. */
  async sendWhatsAppMessage(to: string, from: string, body: string): Promise<void> {
    const accountSid = this.config.get('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get('TWILIO_AUTH_TOKEN');
    if (!accountSid || !authToken) {
      this.logger.warn('Twilio not configured — dropping outbound WhatsApp message');
      return;
    }

    const params = new URLSearchParams({ To: to, From: from, Body: body });
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const response = await fetch(`${BASE_URL}/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Twilio send failed (${response.status}): ${errorBody}`);
    }
  }
}
