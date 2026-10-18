import { describe, expect, it } from 'vitest';
import { duplicateReason } from '../../lib/slack/events';

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://till.example/api/webhooks/slack', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('slack deliveries', () => {
  it('handles an app mention', async () => {
    expect(await duplicateReason(json({ type: 'event_callback', event: { type: 'app_mention' } }))).toBeNull();
  });

  it('skips the channel message copy of a mention', async () => {
    const reason = await duplicateReason(json({ event: { type: 'message', channel_type: 'channel' } }));
    expect(reason).toMatch(/channel message/);
  });

  it.each(['channel', 'group', 'mpim'])('drops every %s message before it reaches Till', async (channelType) => {
    const reason = await duplicateReason(json({ event: { type: 'message', channel_type: channelType } }));
    expect(reason).not.toBeNull();
  });

  it('handles direct messages', async () => {
    expect(await duplicateReason(json({ event: { type: 'message', channel_type: 'im' } }))).toBeNull();
  });

  it('skips slack retries', async () => {
    expect(await duplicateReason(json({ event: { type: 'app_mention' } }, { 'x-slack-retry-num': '1' }))).toBe('slack retry');
  });

  it('handles button clicks, which arrive form encoded', async () => {
    const click = new Request('https://till.example/api/webhooks/slack', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'payload=%7B%7D',
    });
    expect(await duplicateReason(click)).toBeNull();
  });

  it('leaves the body readable for the real handler', async () => {
    const request = json({ event: { type: 'app_mention' } });
    await duplicateReason(request);
    await expect(request.json()).resolves.toEqual({ event: { type: 'app_mention' } });
  });
});
