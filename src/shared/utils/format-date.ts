const FORMATTER = new Intl.DateTimeFormat('en-NG', {
  timeZone: 'Africa/Lagos',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Receipt timestamps, always in Lagos local time regardless of server TZ. */
export function formatReceiptDate(date: Date): string {
  return FORMATTER.format(date);
}
