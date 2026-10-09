import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Twilio's webhook signature algorithm: HMAC-SHA1(authToken, url + sorted
 * "key"+"value" pairs concatenated with no separator), base64-encoded,
 * compared against the X-Twilio-Signature header. The `url` must be exactly
 * what Twilio was configured to call (scheme+host+path) — reconstructed
 * from APP_BASE_URL rather than trusted from the request itself.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
): boolean {
  if (!signature) return false;

  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], url);
  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64');

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
