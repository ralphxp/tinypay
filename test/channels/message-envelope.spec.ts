import { maskAccountNumbers, renderEnvelope } from '../../src/modules/channels/renderers/message-envelope.js';

describe('maskAccountNumbers', () => {
  it('masks a 10-digit NUBAN account number, keeping only the last 4 digits', () => {
    expect(maskAccountNumbers('Send to 0123456789 at GTBank')).toBe('Send to •••6789 at GTBank');
  });

  it('masks every account number when more than one appears', () => {
    expect(maskAccountNumbers('from 0123456789 to 9876543210')).toBe('from •••6789 to •••3210');
  });

  it('does not touch numbers that are not exactly 10 digits (amounts, ids, phone-like 11-digit runs)', () => {
    expect(maskAccountNumbers('amount 5000000, ref 12345, phone 08031234567')).toBe(
      'amount 5000000, ref 12345, phone 08031234567',
    );
  });

  it('leaves text with no account number untouched', () => {
    expect(maskAccountNumbers('Your balance is ₦0.00')).toBe('Your balance is ₦0.00');
  });
});

describe('renderEnvelope', () => {
  it('wraps the (masked) body in a header + divider + divider envelope', () => {
    const rendered = renderEnvelope({ text: 'Send 5000000 minor units to 0123456789? Reply yes to confirm.' });
    const lines = rendered.text.split('\n');
    expect(lines[0]).toBe('TinyPay');
    expect(lines[1]).toMatch(/^─+$/);
    expect(lines[2]).toBe('Send 5000000 minor units to •••6789? Reply yes to confirm.');
    expect(lines[3]).toMatch(/^─+$/);
  });

  it('passes choices through unchanged for the adapter to render as buttons', () => {
    const rendered = renderEnvelope({ text: 'Confirm?', choices: ['yes', 'cancel'] });
    expect(rendered.choices).toEqual(['yes', 'cancel']);
  });

  it('omits choices entirely when the source message has none', () => {
    const rendered = renderEnvelope({ text: 'Your balance is ₦0.00' });
    expect(rendered.choices).toBeUndefined();
  });
});
