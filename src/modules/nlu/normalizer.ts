import type { Network } from '@prisma/client';
import { StepError } from '../../common/errors/domain-errors.js';

/**
 * The sole owner of canonicalization. Grammar only ever emits raw strings
 * (amountRaw, networkRaw...); nothing upstream of this file is allowed to
 * turn "500" into a bigint or "mtn" into a Network enum value. These
 * functions own rejection, via StepError, so a bad value re-prompts the
 * current FSM step instead of reaching a slot.
 */

const NAIRA_WORDS = /naira|ngn/gi;
const THOUSAND_SUFFIX = /k$/i;

/** "500" / "₦5,000" / "5k" -> minor units (kobo). Rejects non-positive or unparseable amounts. */
export function parseAmountMinor(amountRaw: string): bigint {
  let cleaned = amountRaw
    .trim()
    .toLowerCase()
    .replace(/₦/g, '')
    .replace(NAIRA_WORDS, '')
    .replace(/,/g, '')
    .trim();

  if (!cleaned) {
    throw new StepError('Enter an amount, e.g. 500 or 5k.');
  }

  let multiplier = 1;
  if (THOUSAND_SUFFIX.test(cleaned)) {
    multiplier = 1000;
    cleaned = cleaned.replace(THOUSAND_SUFFIX, '').trim();
  }

  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new StepError(`"${amountRaw}" isn't a clear amount — try something like 500 or 5k.`);
  }

  const value = Number(cleaned) * multiplier;
  if (!Number.isFinite(value) || value <= 0) {
    throw new StepError('Enter an amount greater than zero.');
  }

  return BigInt(Math.round(value * 100));
}

const NETWORK_ALIASES: Record<string, Network> = {
  mtn: 'mtn',
  glo: 'glo',
  airtel: 'airtel',
  '9mobile': 'nine_mobile',
  '9-mobile': 'nine_mobile',
  ninemobile: 'nine_mobile',
  'nine mobile': 'nine_mobile',
};

/** "mtn" / "9mobile" / "Airtel" -> the Network enum value. Rejects anything unrecognized. */
export function normalizeNetwork(networkRaw: string): Network {
  const needle = networkRaw.trim().toLowerCase().replace(/\s+/g, ' ');
  const network = NETWORK_ALIASES[needle] ?? NETWORK_ALIASES[needle.replace(/\s/g, '')];
  if (!network) {
    throw new StepError(`I don't recognize the network "${networkRaw}" — try MTN, Glo, Airtel, or 9mobile.`);
  }
  return network;
}
