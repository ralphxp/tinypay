import type { InboundEvent } from '../types.js';

/** The raw string this turn carries — a tap's `value` or free text's `text`, whichever is present. */
export function inputText(evt: InboundEvent): string | undefined {
  const value = evt.payload?.value;
  if (typeof value === 'string' && value.trim()) return value.trim();
  const text = evt.payload?.text;
  if (typeof text === 'string' && text.trim()) return text.trim();
  return undefined;
}

const YES = /^(?:yes|y|confirm|ok|okay)$/i;

export function isAffirmative(evt: InboundEvent): boolean {
  const t = inputText(evt);
  return !!t && YES.test(t);
}
