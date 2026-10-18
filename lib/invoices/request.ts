import { z } from 'zod';
import { SLACK_USER_ID } from '../slack/user-id';

/**
 * An invoice request and its approval. With no database, a pending invoice travels in the Slack
 * buttons and the signed login link, and is validated again whenever it comes back.
 */

const MAX_ID_LENGTH = 80;
const MAX_NAME_LENGTH = 120;
const MAX_THREAD_ID_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 200;
const SLACK_CHANNEL_ID = /^[A-Z0-9]{5,20}$/;
const SLACK_MESSAGE_TS = /^\d{6,12}\.\d{1,8}$/;
/** Slack refuses a button value longer than this. */
export const MAX_BUTTON_VALUE_LENGTH = 2000;
const MAX_INVOICE_AMOUNT = 1_000_000;
const MAX_DAYS_UNTIL_DUE = 120;
const CURRENCY_CODE = /^[A-Z]{3}$/;
// One approval card per admin; config caps admins at this number too.
export const MAX_APPROVAL_CARDS = 5;

/** What the model extracts from the conversation. Who asked comes from Slack, never from the model. */
export const invoiceRequestSchema = z.object({
  customer: z.string().min(1).max(MAX_NAME_LENGTH).describe('Client name as the person wrote it'),
  description: z.string().min(1).max(MAX_DESCRIPTION_LENGTH).describe('Line item description'),
  amount: z.number().positive().max(MAX_INVOICE_AMOUNT).describe('Amount in major units, e.g. 4800'),
  currency: z.string().regex(CURRENCY_CODE).describe('ISO 4217 code, e.g. USD'),
  daysUntilDue: z.number().int().min(0).max(MAX_DAYS_UNTIL_DUE).describe('Payment terms in days, e.g. 14 for net 14'),
});

export type InvoiceRequest = z.infer<typeof invoiceRequestSchema>;

const personSchema = z.object({
  id: z.string().regex(SLACK_USER_ID),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
});

const threadId = z.string().min(1).max(MAX_THREAD_ID_LENGTH);

export const pendingInvoiceSchema = z.object({
  request: invoiceRequestSchema,
  /** The Airwallex client Till resolved before asking. The card shows this name. */
  client: z.object({ id: z.string().min(1).max(MAX_ID_LENGTH), name: z.string().min(1).max(MAX_NAME_LENGTH) }),
  /** Airwallex request_id, fixed per request, so every card and retry creates at most one invoice. */
  requestId: z.string().regex(/^[\w.-]{1,64}$/),
  /** Who asked, and the DM where Till reports back to them. */
  requester: personSchema.extend({ threadId }),
  /** Every approval card for this request (a DM channel and a message), so the first decision can close the others. */
  cards: z
    .array(z.object({ channel: z.string().regex(SLACK_CHANNEL_ID), messageId: z.string().regex(SLACK_MESSAGE_TS) }))
    .max(MAX_APPROVAL_CARDS),
});

/** An invoice waiting for a finance admin: what to create, for whom, and where its cards are. */
export type PendingInvoice = z.infer<typeof pendingInvoiceSchema>;

export const approvedInvoiceSchema = z.object({ pending: pendingInvoiceSchema, approver: personSchema });

/** An approved invoice: created with the approver's own Airwallex login. */
export type ApprovedInvoice = z.infer<typeof approvedInvoiceSchema>;

/** Validates untrusted data as a pending invoice. Returns null when anything is off. */
export function parsePending(value: unknown): PendingInvoice | null {
  const parsed = pendingInvoiceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type ApprovalCardRef = PendingInvoice['cards'][number];

/** For Slack button values. Slack returns them exactly as Till posted them. */
export function encodePending(pending: PendingInvoice): string {
  return Buffer.from(JSON.stringify(pending)).toString('base64url');
}

/**
 * Whether the request still fits in a button value once a card is listed for each approver.
 * Checked before any card goes out, using the longest ids Slack hands out.
 */
export function fitsInButton(draft: PendingInvoice, approvers: number): boolean {
  const longest: ApprovalCardRef = { channel: 'D'.repeat(20), messageId: `${'9'.repeat(12)}.${'9'.repeat(8)}` };
  const full = { ...draft, cards: Array.from({ length: approvers }, () => longest) };
  return encodePending(full).length <= MAX_BUTTON_VALUE_LENGTH;
}

export function decodePending(encoded: string): PendingInvoice | null {
  try {
    return parsePending(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

/** Slack message ids hold dots; Airwallex request ids allow word characters, dots and dashes. */
export const requestIdFor = (messageId: string): string => `till-${messageId.replace(/[^\w.-]/g, '')}`.slice(0, 64);

export function formatAmount({ amount, currency }: Pick<InvoiceRequest, 'amount' | 'currency'>): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type Decision = { ok: true } | { ok: false; reason: 'invalid' | 'unknown-card' | 'not-approver' };

interface Click {
  clicker: string;
  clickerIsAdmin: boolean;
  /** Chat SDK thread id of the clicked message, `slack:<channel>:<thread ts>`. */
  threadId: string;
  messageId: string;
}

/** The Slack channel inside a Chat SDK thread id. */
export const channelOf = (threadId: string): string => threadId.split(':')[1] ?? '';

/** Only a finance admin may decide, and only on one of the cards Till posted for this request. */
export function checkDecision(pending: PendingInvoice | null, click: Click): Decision {
  if (!pending) return { ok: false, reason: 'invalid' };
  const channel = channelOf(click.threadId);
  const known = pending.cards.some((card) => card.channel === channel && card.messageId === click.messageId);
  if (!known) return { ok: false, reason: 'unknown-card' };
  if (!click.clickerIsAdmin) return { ok: false, reason: 'not-approver' };
  return { ok: true };
}
