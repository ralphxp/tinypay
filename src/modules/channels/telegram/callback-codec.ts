/**
 * Encodes a tapped choice as `{flow, step, value}` so most FSM steps are
 * taps, not free-text parsing — feeds back into the pipeline as a
 * pre-resolved event, bypassing NLU entirely (see TelegramAdapter). Telegram
 * caps callback_data at 64 bytes, so this is a compact, colon-joined triple
 * rather than JSON; flow/step/value are all short, closed-vocabulary
 * identifiers (never user-supplied free text), so no escaping is needed.
 */
export interface DecodedCallback {
  flow: string;
  step: string;
  value: string;
}

const SEP = ':';

export function encodeCallback(flow: string, step: string, value: string): string {
  const data = [flow, step, value].join(SEP);
  if (Buffer.byteLength(data, 'utf8') > 64) {
    throw new Error(`callback_data exceeds Telegram's 64-byte limit: ${data}`);
  }
  return data;
}

export function decodeCallback(data: string): DecodedCallback | null {
  const parts = data.split(SEP);
  if (parts.length !== 3) return null;
  const [flow, step, value] = parts as [string, string, string];
  if (!flow || !step || !value) return null;
  return { flow, step, value };
}
