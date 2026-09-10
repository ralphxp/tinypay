import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';

/** "5,000" / "₦5000" / "5k" / "5000 naira" -> minor units (kobo). */
export function parseAmountToMinor(rawText: string): bigint | null {
  let cleaned = rawText
    .trim()
    .toLowerCase()
    .replace(/₦/g, '')
    .replace(/naira|ngn/g, '')
    .replace(/,/g, '')
    .trim();

  let multiplier = 1;
  if (cleaned.endsWith('k')) {
    multiplier = 1000;
    cleaned = cleaned.slice(0, -1).trim();
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;

  return BigInt(Math.round(value * multiplier * 100));
}

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

@Injectable()
export class NormalizerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves a bank name/alias/code (e.g. "gtb", "GTBank", "058") to its code. */
  async resolveBankCode(rawText: string): Promise<string | null> {
    const needle = rawText.trim().toLowerCase();
    const bank = await this.prisma.bank.findFirst({
      where: {
        OR: [{ name: { equals: needle, mode: 'insensitive' } }, { aliases: { has: needle } }, { code: needle }],
      },
    });
    return bank?.code ?? null;
  }
}
