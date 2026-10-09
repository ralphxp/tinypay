import { createHmac } from 'node:crypto';
import { validateTwilioSignature } from '../../src/modules/channels/whatsapp/twilio-signature.js';

const AUTH_TOKEN = 'test_auth_token';
const URL = 'https://tinypay.example.com/webhooks/whatsapp';
const PARAMS = { From: 'whatsapp:+2348031234567', Body: 'tinypay balance', To: 'whatsapp:+14155238886' };

function realSignature(url: string, params: Record<string, string>, token = AUTH_TOKEN): string {
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', token).update(data, 'utf8').digest('base64');
}

describe('validateTwilioSignature', () => {
  it('accepts a correctly computed signature', () => {
    const signature = realSignature(URL, PARAMS);
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, signature)).toBe(true);
  });

  it('rejects a signature computed with the wrong auth token', () => {
    const signature = realSignature(URL, PARAMS, 'wrong_token');
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, signature)).toBe(false);
  });

  it('rejects when the body was tampered with after signing', () => {
    const signature = realSignature(URL, PARAMS);
    const tampered = { ...PARAMS, Body: 'tinypay fund 999999' };
    expect(validateTwilioSignature(AUTH_TOKEN, URL, tampered, signature)).toBe(false);
  });

  it('rejects when the URL does not match what was signed (e.g. wrong path)', () => {
    const signature = realSignature(URL, PARAMS);
    expect(validateTwilioSignature(AUTH_TOKEN, 'https://tinypay.example.com/webhooks/other', PARAMS, signature)).toBe(
      false,
    );
  });

  it('rejects a missing signature', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, undefined)).toBe(false);
  });

  it('is order-independent — param insertion order never changes the result', () => {
    const signature = realSignature(URL, PARAMS);
    const reordered = { To: PARAMS.To, Body: PARAMS.Body, From: PARAMS.From };
    expect(validateTwilioSignature(AUTH_TOKEN, URL, reordered, signature)).toBe(true);
  });
});
