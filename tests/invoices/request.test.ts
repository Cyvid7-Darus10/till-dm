import { describe, expect, it } from 'vitest';
import { checkDecision, decodePending, encodePending, formatAmount, MAX_APPROVAL_CARDS, requestIdFor } from '../../lib/invoices/request';
import { pending } from '../fixtures';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('pending invoice in a button value', () => {
  it('survives the round trip unchanged', () => {
    expect(decodePending(encodePending(pending))).toEqual(pending);
  });

  it('fits in a Slack button value even with every card listed', () => {
    const card = { threadId: 'slack:D0ALEX0001:', messageId: '1792068290.000100' };
    const full = { ...pending, cards: Array.from({ length: MAX_APPROVAL_CARDS }, () => card) };
    expect(encodePending(full).length).toBeLessThan(2000);
  });

  it('is rejected when it is not valid base64 json', () => {
    expect(decodePending('not-a-payload')).toBeNull();
    expect(decodePending('')).toBeNull();
  });

  it('is rejected when a field breaks the schema', () => {
    const negative = { ...pending, request: { ...pending.request, amount: -1 } };
    const badCurrency = { ...pending, request: { ...pending.request, currency: 'usd' } };
    const badRequester = { ...pending, requester: { ...pending.requester, id: '<script>' } };
    const badRequestId = { ...pending, requestId: 'has spaces' };
    for (const value of [negative, badCurrency, badRequester, badRequestId]) {
      expect(decodePending(encode(value))).toBeNull();
    }
  });
});

describe('who may decide on an invoice', () => {
  const [alexCard, joCard] = pending.cards;
  const click = { clicker: 'UADMIN0001', clickerIsAdmin: true, ...alexCard };

  it('lets a finance admin decide on one of the cards Till posted', () => {
    expect(checkDecision(pending, click)).toEqual({ ok: true });
    expect(checkDecision(pending, { ...click, ...joCard })).toEqual({ ok: true });
  });

  it('refuses someone who is not a finance admin', () => {
    expect(checkDecision(pending, { ...click, clicker: 'UMEMBER001', clickerIsAdmin: false })).toEqual({
      ok: false,
      reason: 'not-approver',
    });
  });

  it('refuses a request value pasted onto any other message', () => {
    expect(checkDecision(pending, { ...click, messageId: '1792068299.999999' })).toEqual({ ok: false, reason: 'unknown-card' });
    expect(checkDecision(pending, { ...click, threadId: 'slack:C0FINANCE1:' })).toEqual({ ok: false, reason: 'unknown-card' });
  });

  it('refuses a card whose value could not be read', () => {
    expect(checkDecision(null, click)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('request ids', () => {
  it('come from the Slack message id and keep only characters Airwallex accepts', () => {
    expect(requestIdFor('1792068287.429589')).toBe('till-1792068287.429589');
    expect(requestIdFor('17920:68287/4')).toBe('till-17920682874');
  });
});

describe('amounts', () => {
  it('show the currency code and two decimals', () => {
    expect(formatAmount({ amount: 4800, currency: 'USD' })).toBe('USD 4,800.00');
    expect(formatAmount({ amount: 6200.5, currency: 'EUR' })).toBe('EUR 6,200.50');
  });
});
