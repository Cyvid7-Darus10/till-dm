import { beforeEach, describe, expect, it, vi } from 'vitest';

// Slack, the model and Airwallex are replaced with fakes, so these tests can show exactly what Till
// reads and posts for each kind of conversation.
const fakeAdapter = vi.hoisted(() => ({
  name: 'slack',
  userName: 'Till',
  initialize: async () => {},
  fetchChannelMessages: async () => ({ messages: [] }),
}));
vi.mock('@chat-adapter/slack', () => ({ createSlackAdapter: () => fakeAdapter }));
vi.mock('@vercel/connect/chat', () => ({ connectSlackAdapter: () => ({}) }));
vi.mock('@vercel/connect', () => ({ startAuthorization: vi.fn(async () => ({ url: 'https://example.com/consent' })) }));
vi.mock('../../lib/agent/jobs', () => ({ answer: vi.fn(), createInvoice: vi.fn() }));
vi.mock('../../lib/airwallex/session', () => ({ isConnected: vi.fn(), openAirwallex: vi.fn() }));

vi.stubEnv('TILL_FINANCE_MEMBER_SLACK_IDS', 'UMEMBER001');
const { handleDirectMessage, handleMention } = await import('../../lib/slack/bot');
const { answer } = await import('../../lib/agent/jobs');
const { isConnected, openAirwallex } = await import('../../lib/airwallex/session');
const { COPY } = await import('../../lib/copy');

type Conversation = { channel: string; isDM: boolean };
const DM: Conversation = { channel: 'D0SAM00001', isDM: true };
const CHANNEL: Conversation = { channel: 'C0FINANCE1', isDM: false };
const GROUP_DM: Conversation = { channel: 'G0GROUPDM1', isDM: false };

function threadIn({ channel, isDM }: Conversation) {
  return {
    id: `slack:${channel}:`,
    channelId: `slack:${channel}`,
    isDM,
    adapter: fakeAdapter,
    post: vi.fn(async () => ({ id: '1792068290.000100' })),
    startTyping: vi.fn(async () => {}),
    mentionUser: (id: string) => `<@${id}>`,
  };
}

const messageFrom = (userId: string, text = 'which invoices are still unpaid?') => ({
  id: '1792068287.429589',
  text,
  author: { userId, userName: 'sam', fullName: 'Sam Ortiz', isBot: false, isMe: false },
});

// Any of these means Till looked at finance data or the model.
const touchedFinances = () =>
  vi.mocked(answer).mock.calls.length + vi.mocked(isConnected).mock.calls.length + vi.mocked(openAirwallex).mock.calls.length;

// The handlers accept the SDK's Thread and Message; the fakes carry only what they use.
const asThread = (thread: ReturnType<typeof threadIn>) => thread as unknown as Parameters<typeof handleDirectMessage>[0];
const asMessage = (message: ReturnType<typeof messageFrom>) => message as unknown as Parameters<typeof handleDirectMessage>[1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isConnected).mockResolvedValue(true);
  vi.mocked(answer).mockResolvedValue({ kind: 'text', text: 'Three invoices are unpaid.' });
});

describe('a mention in a channel', () => {
  it('gets only the fixed "send me a DM" sentence, and Till reads nothing', async () => {
    const thread = threadIn(CHANNEL);
    await handleMention(asThread(thread));
    expect(thread.post).toHaveBeenCalledTimes(1);
    expect(thread.post).toHaveBeenCalledWith(COPY.dmOnly);
    expect(touchedFinances()).toBe(0);
  });
});

describe('the DM handler', () => {
  it.each([
    ['a channel', CHANNEL],
    ['a group DM', GROUP_DM],
  ])('refuses %s even from a finance member, without reading anything', async (_name, conversation) => {
    const thread = threadIn(conversation);
    await handleDirectMessage(asThread(thread), asMessage(messageFrom('UMEMBER001')));
    expect(thread.post).toHaveBeenCalledTimes(1);
    expect(thread.post).toHaveBeenCalledWith(COPY.dmOnly);
    expect(touchedFinances()).toBe(0);
  });

  it('turns away someone outside the finance team, without reading anything', async () => {
    const thread = threadIn(DM);
    await handleDirectMessage(asThread(thread), asMessage(messageFrom('UOUTSIDE01')));
    expect(thread.post).toHaveBeenCalledWith(COPY.notOnTeam);
    expect(touchedFinances()).toBe(0);
  });

  it('answers a finance member in their DM', async () => {
    const thread = threadIn(DM);
    await handleDirectMessage(asThread(thread), asMessage(messageFrom('UMEMBER001')));
    expect(answer).toHaveBeenCalledTimes(1);
    expect(thread.post).toHaveBeenCalledTimes(1);
    expect(thread.post).not.toHaveBeenCalledWith(COPY.dmOnly);
  });
});
