import { createSlackAdapter } from '@chat-adapter/slack';
import { createMemoryState } from '@chat-adapter/state-memory';
import { startAuthorization } from '@vercel/connect';
import { connectSlackAdapter } from '@vercel/connect/chat';
import { type ActionEvent, type Author, Chat, type Message, type Thread } from 'chat';
import { toAiMessages } from 'chat/ai';
import { answer, createInvoice } from '../agent/jobs';
import { signLoginLink } from '../airwallex/login-link';
import { forCreating, forQuestions } from '../airwallex/logins';
import { isConnected, openAirwallex } from '../airwallex/session';
import { SCOPES } from '../airwallex/tool-policy';
import { config, isFinanceAdmin, isFinanceMember } from '../config';
import { COPY } from '../copy';
import { type CustomerMatch, findCustomer } from '../invoices/customer-match';
import {
  type ApprovedInvoice,
  checkDecision,
  decodePending,
  formatAmount,
  type InvoiceRequest,
  type PendingInvoice,
  requestIdFor,
} from '../invoices/request';
import { log } from '../log';
import { ACTIONS, approvalCard, connectCard, reply, resolvedCard } from './cards';
import { plainText } from './text';

/** Where the Airwallex login sends people back to. Paths are defined by the route files under app/api/. */
export const CALLBACK_PATH = '/api/airwallex/connected';
export const CALLBACK_PARAM = { token: 't', team: 'team' } as const;

// No database: memory state only covers dedupe and locks within one instance.
// Everything Till needs to remember travels in button values and signed links.
export const bot = new Chat({
  userName: 'Till',
  adapters: { slack: createSlackAdapter({ ...connectSlackAdapter(config.slackConnector), userName: 'Till' }) },
  state: createMemoryState(),
}).registerSingleton();

const displayName = (author: Author): string => author.fullName || author.userName;

/** Recent messages in this DM, with each person's name in front, for the model. */
async function dmHistory(thread: Thread) {
  const fetchChannelMessages = thread.adapter.fetchChannelMessages?.bind(thread.adapter);
  if (!fetchChannelMessages) throw new Error('the Slack adapter cannot read DM history');
  const { messages } = await fetchChannelMessages(thread.channelId, { limit: config.historyLimit });
  return toAiMessages(messages, {
    transformMessage: (ai, source) =>
      ai.role === 'user' && typeof ai.content === 'string' ? { ...ai, content: `[${displayName(source.author)}] ${ai.content}` } : ai,
  });
}

/** Public base URL of this deployment (Vercel system variables), for the login callback. */
function publicOrigin(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (!host) throw new Error('no deployment url to send the Airwallex login back to');
  return `https://${host}`;
}

/** Finds the exact Airwallex client with the view-only team login, so the card can name it. */
async function resolveClient(request: InvoiceRequest): Promise<CustomerMatch> {
  const airwallex = await openAirwallex(forQuestions(), SCOPES.questions, 'view');
  try {
    return await findCustomer(airwallex, request.customer);
  } finally {
    await airwallex.close();
  }
}

const editCard = (card: PendingInvoice['cards'][number], content: ReturnType<typeof approvalCard>) =>
  bot.getAdapter('slack').editMessage(card.threadId, card.messageId, content);

/**
 * Someone asked for an invoice. Till resolves the exact client, then sends an approval card to every
 * finance admin (or only to the requester, if they are an admin) and tells the requester.
 */
async function requestApproval(thread: Thread, message: Message, request: InvoiceRequest): Promise<void> {
  const match = await resolveClient(request);
  if (!match.ok) {
    await thread.post(reply(COPY.notCreated(match.problem), COPY.teamLoginLabel));
    return;
  }
  const requester = message.author;
  const draft: PendingInvoice = {
    request,
    client: match.customer,
    requestId: requestIdFor(message.id),
    requester: { id: requester.userId, name: displayName(requester), threadId: thread.id },
    cards: [],
  };
  const approvers = isFinanceAdmin(requester.userId) ? [requester.userId] : config.financeAdminSlackIds;
  const cards = await Promise.all(
    approvers.map(async (adminId) => {
      const dm = await bot.openDM(adminId);
      const sent = await dm.post(approvalCard(draft));
      return { threadId: dm.id, messageId: sent.id };
    }),
  );
  // Each card's buttons now list every card, so the first decision can close the rest.
  const pending: PendingInvoice = { ...draft, cards };
  await Promise.all(cards.map((card) => editCard(card, approvalCard(pending))));
  if (isFinanceAdmin(requester.userId)) return;
  const admins = approvers.map((id) => thread.mentionUser(id)).join(', ');
  await thread.post(reply(COPY.sentForApproval(pending.client.name, formatAmount(request), admins), COPY.teamLoginLabel));
}

/** No team login yet. Members hear that; an admin also gets the button to connect it, once. */
async function noAccess(thread: Thread, author: Author): Promise<void> {
  await thread.post(COPY.noAccess);
  if (!isFinanceAdmin(author.userId)) return;
  const callbackUrl = new URL(CALLBACK_PATH, publicOrigin());
  callbackUrl.searchParams.set(CALLBACK_PARAM.team, '1');
  const { url } = await startAuthorization(
    config.airwallexConnector,
    { subject: forQuestions(), scopes: [...SCOPES.questions] },
    { callbackUrl: callbackUrl.toString() },
  );
  await thread.post(connectCard(url, 'team'));
}

bot.onDirectMessage(async (thread, message) => {
  const author = message.author;
  if (!isFinanceMember(author.userId)) {
    log.info('ignored a DM from someone outside the finance team', { userId: author.userId });
    await thread.post(COPY.notOnTeam);
    return;
  }
  try {
    if (!(await isConnected(forQuestions(), SCOPES.questions))) {
      await noAccess(thread, author);
      return;
    }
    await thread.startTyping();
    const result = await answer(await dmHistory(thread));
    if (result.kind === 'text') {
      await thread.post(reply(plainText(result.text), COPY.teamLoginLabel));
    } else {
      await requestApproval(thread, message, result.request);
    }
  } catch (error: unknown) {
    log.error('failed to answer a DM', { threadId: thread.id, error });
    await thread.post(COPY.somethingWrong);
  }
});

// In a channel, everyone would read the answer, so Till points people to a DM instead.
bot.onNewMention(async (thread) => {
  await thread.post(COPY.dmOnly);
});

/** True once the shared team login is connected. Called by the login callback. */
export async function teamLoginConnected(): Promise<boolean> {
  return isConnected(forQuestions(), SCOPES.questions);
}

/** Replaces every approval card for this request with its outcome. One failed edit doesn't stop the rest. */
async function closeCards(pending: PendingInvoice, outcome: string): Promise<void> {
  const results = await Promise.allSettled(pending.cards.map((card) => editCard(card, resolvedCard(pending, outcome))));
  for (const result of results) {
    if (result.status === 'rejected') log.warn('failed to close an approval card', { error: result.reason });
  }
}

const postTo = async (threadId: string, text: string, who: string): Promise<void> => {
  await bot.thread(threadId).post(reply(text, who));
};

/** Creates the approved invoice with the approver's login and tells the approver and the requester. */
export async function finishApproval(approved: ApprovedInvoice): Promise<void> {
  const { pending, approver } = approved;
  const approverDm = (await bot.openDM(approver.id)).id;
  const requesterIsApprover = pending.requester.id === approver.id;
  await closeCards(pending, COPY.approved(approver.name));
  try {
    const result = await createInvoice(approved);
    const toApprover = result.ok ? COPY.created(result.number, pending.client.name, result.url) : COPY.notCreated(result.problem);
    await postTo(approverDm, toApprover, approver.name);
    if (requesterIsApprover) return;
    const toRequester = result.ok
      ? COPY.requestApproved(approver.name, result.number, pending.client.name, result.url)
      : COPY.requestFailed(approver.name, result.problem);
    await postTo(pending.requester.threadId, toRequester, approver.name);
  } catch (error: unknown) {
    log.error('failed to create invoice', { requestId: pending.requestId, error });
    await bot.thread(approverDm).post(COPY.somethingWrong);
  }
}

/** Called by the login callback once an approver signs in: true if their login is now connected. */
export async function approverConnected(approved: ApprovedInvoice): Promise<boolean> {
  // This runs from a browser callback, not a Slack event, so the adapter isn't set up yet.
  await bot.initialize();
  return isConnected(forCreating(approved.approver.id), SCOPES.creating);
}

/** Sends the approver a sign-in button whose signed link carries the approval. */
async function askApproverToConnect(thread: NonNullable<ActionEvent['thread']>, approved: ApprovedInvoice): Promise<void> {
  const callbackUrl = new URL(CALLBACK_PATH, publicOrigin());
  callbackUrl.searchParams.set(CALLBACK_PARAM.token, await signLoginLink(approved));
  const { url } = await startAuthorization(
    config.airwallexConnector,
    { subject: forCreating(approved.approver.id), scopes: [...SCOPES.creating] },
    { callbackUrl: callbackUrl.toString() },
  );
  await thread.post(connectCard(url, 'own'));
}

// Approve and Decline carry the whole request. Only a finance admin, on a card Till posted, may press
// them; anything else (stale or tampered) is ignored.
async function decide(event: ActionEvent, approve: boolean): Promise<void> {
  const pending = event.value ? decodePending(event.value) : null;
  const thread = event.thread;
  const clicker = event.user.userId;
  const decision = checkDecision(pending, {
    clicker,
    clickerIsAdmin: isFinanceAdmin(clicker),
    threadId: event.threadId,
    messageId: event.messageId,
  });
  if (!thread || !pending || !decision.ok) {
    log.warn('ignored an approval click', { reason: decision.ok ? 'no thread' : decision.reason, userId: clicker });
    return;
  }
  const approver = { id: clicker, name: displayName(event.user) };
  try {
    if (!approve) {
      await closeCards(pending, COPY.declined(approver.name));
      if (pending.requester.id !== approver.id) {
        await postTo(pending.requester.threadId, COPY.requestDeclined(approver.name, pending.client.name), approver.name);
      }
      return;
    }
    const approved: ApprovedInvoice = { pending, approver };
    // Until the approver signs in, the cards keep their buttons, so the request is never stuck.
    if (await isConnected(forCreating(approver.id), SCOPES.creating)) {
      await finishApproval(approved);
    } else {
      await askApproverToConnect(thread, approved);
    }
  } catch (error: unknown) {
    log.error('failed to handle an approval', { requestId: pending.requestId, error });
    await thread.post(COPY.somethingWrong);
  }
}

bot.onAction(ACTIONS.approve, (event) => decide(event, true));
bot.onAction(ACTIONS.decline, (event) => decide(event, false));
