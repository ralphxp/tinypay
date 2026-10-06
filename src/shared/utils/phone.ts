/** Nigerian local (0...) or +234/234-prefixed numbers -> E.164 (+234...). */
export function normalizePhone(rawText: string): string {
  const digits = rawText.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  return `+${digits}`;
}

/** Nigerian phones are 11 digits locally or 13 with a 234 country code; NUBAN
 * account numbers are always exactly 10 digits with no country code. */
export function isLikelyPhoneNumber(rawText: string): boolean {
  if (rawText.startsWith('+')) return true;
  const digits = rawText.replace(/\D/g, '');
  return digits.length === 11 || digits.length === 13;
}

/** E.164 (+234803...) -> Nigerian local 0-prefixed, 11-digit form (0803...) —
 * the format Bigisub's API expects for `phone_number`. */
export function toLocalPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  const withoutCountryCode = digits.startsWith('234') ? digits.slice(3) : digits.replace(/^0/, '');
  return `0${withoutCountryCode}`;
}
