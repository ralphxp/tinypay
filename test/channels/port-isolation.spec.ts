import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(import.meta.dirname, '../../src');
const TELEGRAM_DIR = join(SRC_ROOT, 'modules/channels/telegram');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function importLines(content: string): string[] {
  return content.split('\n').filter((line) => /^\s*import\b/.test(line));
}

describe('Port isolation: core depends only on ChannelPort, never the Telegram SDK', () => {
  it('no file outside src/modules/channels/telegram imports grammy', () => {
    const offenders: { file: string; line: string }[] = [];

    for (const file of listTsFiles(SRC_ROOT)) {
      if (file.startsWith(TELEGRAM_DIR)) continue; // the Telegram adapter itself is allowed to know grammy

      for (const line of importLines(readFileSync(file, 'utf8'))) {
        if (/from\s+['"]grammy(\/[^'"]*)?['"]/.test(line)) {
          offenders.push({ file: relative(SRC_ROOT, file), line: line.trim() });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('outside the Telegram adapter, the only things ever imported from it are the core/finalized surface (bot client, sender, initializer, module) — never the adapter class or inbound-normalization internals', () => {
    // ChannelPort/OutboundMessage themselves live one level up
    // (channel.port.ts, shared/types) and are not part of this check.
    const allowedFiles = new Set([
      'telegram-core.module.ts',
      'telegram-bot.provider.ts',
      'telegram-sender.service.ts',
      'telegram-bot-initializer.service.ts',
      'telegram-webhook.controller.ts',
      'telegram.adapter.ts', // channels.module.ts (one level up) wires this in; nothing outside modules/channels does
      'callback-codec.ts',
    ]);
    const offenders: { file: string; line: string }[] = [];

    for (const file of listTsFiles(SRC_ROOT)) {
      if (file.startsWith(TELEGRAM_DIR)) continue;
      if (file === join(SRC_ROOT, 'modules/channels/channels.module.ts')) continue; // the composition root for this channel

      for (const line of importLines(readFileSync(file, 'utf8'))) {
        const match = /from\s+['"](.*modules\/channels\/telegram\/[^'"]+)['"]/.exec(line);
        if (!match) continue;
        const importedFile = match[1]!.split('/').pop()!.replace(/\.js$/, '.ts');
        if (!allowedFiles.has(importedFile)) {
          offenders.push({ file: relative(SRC_ROOT, file), line: line.trim() });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
