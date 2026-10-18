import { describe, expect, it } from 'vitest';
import { COPY } from '../../lib/copy';
import { plainText, safeLink } from '../../lib/slack/text';

describe('text from people and the model', () => {
  it('cannot ping the channel, mention someone or disguise a link', () => {
    const text = plainText('Hi <!channel>, ask <@U123> or <https://evil.example|Approve>');
    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain('‹!channel›');
  });

  it('is neutralised inside every message Till builds from it', () => {
    expect(COPY.card.title('<!here>')).toBe('Invoice ‹!here›');
    expect(COPY.created('INV-1', '<!channel>', 'https://example.com/i')).toBe(
      'Created invoice INV-1 for ‹!channel›. <https://example.com/i|Open invoice>',
    );
  });
});

describe('invoice links', () => {
  it('are kept only when they are https', () => {
    expect(safeLink('https://example.com/i')).toBe('https://example.com/i');
    expect(safeLink('javascript:alert(1)')).toBe('');
    expect(safeLink('http://example.com')).toBe('');
    expect(safeLink('not a url')).toBe('');
  });
});
