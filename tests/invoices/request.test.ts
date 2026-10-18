import { describe, expect, it } from 'vitest';
import {
  channelOf,
  checkDecision,
  decodePending,
  encodePending,
  fitsInButton,
  formatAmount,
  MAX_APPROVAL_CARDS,
  MAX_BUTTON_VALUE_LENGTH,
  requestIdFor,
} from '../../lib/invoices/request';
import { pending } from '../fixtures';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('pending invoice in a button value', () => {
  it('survives the round trip unchanged', () => {
    expect(decodePending(encodePending(pending))).toEqual(pending);
  });

  it('fits in a Slack button value even with every card listed', () => {
    expect(fitsInButton(pending, MAX_APPROVAL_CARDS)).toBe(true);
  });

  it('fits with the longest allowed plain-text fields', () => {
    const long = 'x'.repeat(120);
    const longest = {
      ...pending,
      request: { ...pending.request, customer: long, description: 'y'.repeat(200) },
      client: { id: 'c'.repeat(80), name: long },
      requester: { ...pending.requester, name: long },
    };
    expect(fitsInButton(longest, MAX_APPROVAL_CARDS)).toBe(true);
  });

  it('is refused before posting when non-Latin text would overflow the button', () => {
    // Three bytes each in UTF-8, so the encoded value grows past Slack's limit.
    const long = '漢'.repeat(120);
    const huge = { ...pending, request: { ...pending.request, customer: long, description: '字'.repeat(200) } };
    expect(fitsInButton(huge, MAX_APPROVAL_CARDS)).toBe(false);
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
    const badCard = { ...pending, cards: [{ channel: 'D0ALEX0001', messageId: 'not-a-ts' }] };
    for (const value of [negative, badCurrency, badRequester, badRequestId, badCard]) {
      expect(decodePending(encode(value))).toBeNull();
    }
  });
});

describe('who may decide on an invoice', () => {
  const [alexCard, joCard] = pending.cards;
  // Slack reports a click on a top-level DM message with the message's own ts as its thread.
  const clickOn = (card: (typeof pending.cards)[number]) => ({
    clicker: 'UADMIN0001',
    clickerIsAdmin: true,
    threadId: `slack:${card.channel}:${card.messageId}`,
    messageId: card.messageId,
  });

  it('lets a finance admin decide on one of the cards Till posted', () => {
    expect(checkDecision(pending, clickOn(alexCard))).toEqual({ ok: true });
    expect(checkDecision(pending, clickOn(joCard))).toEqual({ ok: true });
  });

  it('refuses someone who is not a finance admin', () => {
    expect(checkDecision(pending, { ...clickOn(alexCard), clicker: 'UMEMBER001', clickerIsAdmin: false })).toEqual({
      ok: false,
      reason: 'not-approver',
    });
  });

  it('refuses a request value pasted onto any other message', () => {
    expect(checkDecision(pending, { ...clickOn(alexCard), messageId: '1792068299.999999' })).toEqual({
      ok: false,
      reason: 'unknown-card',
    });
    expect(checkDecision(pending, { ...clickOn(alexCard), threadId: 'slack:C0FINANCE1:1792068290.000100' })).toEqual({
      ok: false,
      reason: 'unknown-card',
    });
  });

  it('refuses a card whose value could not be read', () => {
    expect(checkDecision(null, clickOn(alexCard))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('thread ids', () => {
  it('give up their Slack channel', () => {
    expect(channelOf('slack:D0ALEX0001:1792068290.000100')).toBe('D0ALEX0001');
    expect(channelOf('slack:D0ALEX0001:')).toBe('D0ALEX0001');
    expect(channelOf('garbage')).toBe('');
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
