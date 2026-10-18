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
  type ApprovalCardRef,
  type ApprovedInvoice,
  channelOf,
  checkDecision,
  decodePending,
  fitsInButton,
  formatAmount,
  type InvoiceRequest,
  type PendingInvoice,
  requestIdFor,
} from '../invoices/request';
import { log } from '../log';
import { hasButtons } from './card-state';
import { ACTIONS, approvalCard, connectCard, reply, resolvedCard } from './cards';
import { plainText } from './text';

/** Where the Airwallex login sends people back to. Paths are defined by the route files under app/api/. */
export const CALLBACK_PATH = '/api/airwallex/connected';
export const CALLBACK_PARAM = { token: 't', team: 'team' } as const;

// No database: memory state only covers dedupe and locks within one instance. Everything Till needs to
// remember travels in button values and signed links, and a card's buttons show whether it is decided.
export const bot = new Chat({
  userName: 'Till',
  adapters: { slack: createSlackAdapter({ ...connectSlackAdapter(config.slackConnector), userName: 'Till' }) },
  state: createMemoryState(),
}).registerSingleton();

const slack = () => bot.getAdapter('slack');

const displayName = (author: Author): string => author.fullName || author.userName;

/** Button clicks carry only the Slack handle, so the approver's real name comes from their profile. */
async function approverName(author: Author): Promise<string> {
  const profile = await slack().getUser(author.userId);
  return profile?.fullName || displayName(author);
}

/** Recent messages in this DM, with each person's name in front, for the model. */
async function dmHistory(thread: Thread) {
  const { messages } = await slack().fetchChannelMessages(thread.channelId, { limit: config.historyLimit });
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

// A card is a top-level DM message, so its own timestamp is also its thread.
const cardThreadId = (card: ApprovalCardRef): string => `slack:${card.channel}:${card.messageId}`;

const editCard = (card: ApprovalCardRef, content: ReturnType<typeof approvalCard>) =>
  slack().editMessage(cardThreadId(card), card.messageId, content);

/** True while a card still shows its buttons, meaning nobody has decided on it yet. */
async function isOpen(card: ApprovalCardRef): Promise<boolean> {
  const message = await slack().fetchMessage(cardThreadId(card), card.messageId);
  return message !== null && hasButtons(message.raw);
}

const allOpen = async (pending: PendingInvoice): Promise<boolean> => (await Promise.all(pending.cards.map(isOpen))).every(Boolean);

/** Replaces every card with `content`. Returns false if any edit failed, so that card may still be live. */
async function editCards(cards: readonly ApprovalCardRef[], content: ReturnType<typeof resolvedCard>): Promise<boolean> {
  const results = await Promise.allSettled(cards.map((card) => editCard(card, content)));
  const failed = results.filter((result) => result.status === 'rejected');
  for (const result of failed) log.warn('failed to close an approval card', { error: result.reason });
  return failed.length === 0;
}

/** Posts one card per approver. All or nothing: if any card fails, the ones that went out are cancelled. */
async function postCards(draft: PendingInvoice, approvers: readonly string[]): Promise<PendingInvoice | null> {
  const posted = await Promise.allSettled(
    approvers.map(async (adminId): Promise<ApprovalCardRef> => {
      const dm = await bot.openDM(adminId);
      const sent = await dm.post(approvalCard(draft));
      return { channel: channelOf(dm.id), messageId: sent.id };
    }),
  );
  const cards = posted.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  // Each card's buttons now list every card, so the first decision can close the rest.
  const pending: PendingInvoice = { ...draft, cards };
  const edited = cards.length === approvers.length && (await editCards(cards, approvalCard(pending)));
  if (edited) return pending;
  log.error('failed to send every approval card', { requestId: draft.requestId, sent: cards.length, wanted: approvers.length });
  await editCards(cards, resolvedCard(pending, COPY.cancelledNotSent));
  return null;
}

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
  if (!fitsInButton(draft, approvers.length)) {
    await thread.post(COPY.tooLong);
    return;
  }
  const pending = await postCards(draft, approvers);
  if (!pending) {
    await thread.post(COPY.notSent);
    return;
  }
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

/**
 * Answers a DM. It checks for itself that the conversation is a one-to-one DM, so finance data can't
 * reach a channel or group DM even if an event is ever routed here by mistake.
 */
export async function handleDirectMessage(thread: Thread, message: Message): Promise<void> {
  if (!thread.isDM) {
    log.warn('refused to answer outside a DM', { threadId: thread.id });
    await thread.post(COPY.dmOnly);
    return;
  }
  const author = message.author;
  if (!isFinanceMember(author.userId)) {
    log.info('turned away a DM from outside the finance team', { userId: author.userId });
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
}

/** In a channel, everyone would read the answer, so Till points people to a DM and reads nothing. */
export async function handleMention(thread: Thread): Promise<void> {
  await thread.post(COPY.dmOnly);
}

bot.onDirectMessage(handleDirectMessage);
bot.onNewMention(handleMention);

/** True once the shared team login is connected. Called by the login callback. */
export async function teamLoginConnected(): Promise<boolean> {
  return isConnected(forQuestions(), SCOPES.questions);
}

const postTo = async (threadId: string, text: string, who: string): Promise<void> => {
  await bot.thread(threadId).post(reply(text, who));
};

export type ApprovalState = 'ready' | 'not-connected' | 'not-admin' | 'decided';

/**
 * Whether an approval can go ahead now: the approver is still an admin, their own Airwallex login is
 * connected, and every card is still open. Called on Approve and by the login callback.
 */
export async function checkApproval({ pending, approver }: ApprovedInvoice): Promise<ApprovalState> {
  // The login callback runs from a browser, not a Slack event, so the adapter may not be set up yet.
  await bot.initialize();
  if (!isFinanceAdmin(approver.id)) return 'not-admin';
  if (!(await allOpen(pending))) return 'decided';
  return (await isConnected(forCreating(approver.id), SCOPES.creating)) ? 'ready' : 'not-connected';
}

/**
 * Closes the cards, creates the approved invoice with the approver's login, and tells the approver and
 * the requester. Closing first means a second click or a replayed link finds the request decided.
 */
export async function finishApproval(approved: ApprovedInvoice): Promise<void> {
  const { pending, approver } = approved;
  const requesterIsApprover = pending.requester.id === approver.id;
  let approverDm: string | undefined;
  try {
    approverDm = (await bot.openDM(approver.id)).id;
    if (!(await editCards(pending.cards, resolvedCard(pending, COPY.approved(approver.name))))) {
      throw new Error('an approval card could not be closed');
    }
    const result = await createInvoice(approved);
    // The problem text can name clients and amounts, so only the id goes to the logs.
    if (!result.ok) log.warn('invoice not created', { requestId: pending.requestId });
    const toApprover = result.ok ? COPY.created(result.number, pending.client.name, result.url) : COPY.notCreated(result.problem);
    await postTo(approverDm, toApprover, approver.name);
    if (requesterIsApprover) return;
    const toRequester = result.ok
      ? COPY.requestApproved(approver.name, result.number, pending.client.name, result.url)
      : COPY.requestFailed(approver.name);
    await postTo(pending.requester.threadId, toRequester, approver.name);
  } catch (error: unknown) {
    log.error('failed to finish an approval', { requestId: pending.requestId, error });
    if (approverDm) await bot.thread(approverDm).post(COPY.somethingWrong);
    if (!requesterIsApprover) await postTo(pending.requester.threadId, COPY.requestFailed(approver.name), approver.name);
  }
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

async function decline({ pending, approver }: ApprovedInvoice): Promise<void> {
  if (!(await allOpen(pending))) return;
  await editCards(pending.cards, resolvedCard(pending, COPY.declined(approver.name)));
  if (pending.requester.id === approver.id) return;
  // No Airwallex login was used, so the message has no login caption.
  await bot.thread(pending.requester.threadId).post(COPY.requestDeclined(approver.name, pending.client.name));
}

// Approve and Decline carry the whole request. Only a finance admin, on an open card Till posted, may
// press them; anything else (stale, decided or tampered) is ignored.
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
  try {
    const approved: ApprovedInvoice = { pending, approver: { id: clicker, name: await approverName(event.user) } };
    if (!approve) {
      await decline(approved);
      return;
    }
    const state = await checkApproval(approved);
    if (state === 'ready') await finishApproval(approved);
    // Until the approver signs in, the cards keep their buttons, so the request is never stuck.
    else if (state === 'not-connected') await askApproverToConnect(thread, approved);
    else log.info('ignored an approval click', { reason: state, requestId: pending.requestId });
  } catch (error: unknown) {
    log.error('failed to handle an approval', { requestId: pending.requestId, error });
    await thread.post(COPY.somethingWrong);
  }
}

bot.onAction(ACTIONS.approve, (event) => decide(event, true));
bot.onAction(ACTIONS.decline, (event) => decide(event, false));
