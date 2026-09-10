export function formatNaira(amountMinor: bigint): string {
  const negative = amountMinor < 0n;
  const abs = negative ? -amountMinor : amountMinor;
  const naira = abs / 100n;
  const kobo = abs % 100n;
  return `${negative ? '-' : ''}₦${naira.toLocaleString('en-NG')}.${kobo.toString().padStart(2, '0')}`;
}
