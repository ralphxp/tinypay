import { renderForWhatsApp } from '../../src/modules/channels/whatsapp/render-whatsapp.js';

describe('renderForWhatsApp: OutboundMessage -> plain text (no native buttons on Twilio sandbox)', () => {
  it('no choices: just the envelope-rendered text', () => {
    const text = renderForWhatsApp({ text: 'Your wallet balance is ₦500.00.' });
    expect(text).toContain('Your wallet balance is ₦500.00.');
    expect(text).not.toMatch(/^\d\./m); // no numbered lines
  });

  it('plain string choices become a numbered list the user can reply to by number', () => {
    const text = renderForWhatsApp({ text: 'Which network?', choices: ['MTN', 'Glo', 'Airtel', '9mobile'] });
    expect(text).toContain('1. MTN');
    expect(text).toContain('2. Glo');
    expect(text).toContain('3. Airtel');
    expect(text).toContain('4. 9mobile');
  });

  it('{label, value} choices show the label, not the short value, numbered the same way', () => {
    const text = renderForWhatsApp({
      text: 'Pick a plan:',
      choices: [{ label: '1GB — 30 days — ₦375.00', value: '303' }],
    });
    expect(text).toContain('1. 1GB — 30 days — ₦375.00');
    expect(text).not.toContain('303');
  });

  it('account numbers are still masked (reuses the shared envelope)', () => {
    const text = renderForWhatsApp({ text: 'Sent to 0123456789.' });
    expect(text).toContain('•••6789');
    expect(text).not.toContain('0123456789');
  });
});
