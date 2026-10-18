/** @jsxImportSource chat */
import { Actions, Button, Card, type CardElement, CardText, Field, Fields, LinkButton, toCardElement } from 'chat';
import { COPY } from '../copy';
import { encodePending, formatAmount, type PendingInvoice } from '../invoices/request';
import { plainText } from './text';

/** Slack action ids for the approval buttons. */
export const ACTIONS = { approve: 'approve_invoice', decline: 'decline_invoice' } as const;

/** A reply with a grey caption naming the Airwallex login used. `text` must already be safe Slack text. */
export function reply(text: string, who: string) {
  return (
    <Card>
      <CardText>{text}</CardText>
      <CardText style="muted">{COPY.footer(who)}</CardText>
    </Card>
  );
}

function InvoiceFields({ pending }: { pending: PendingInvoice }) {
  const { request } = pending;
  return (
    <Fields>
      <Field label={COPY.card.lineItem} value={plainText(request.description)} />
      <Field label={COPY.card.amount} value={formatAmount(request)} />
      <Field label={COPY.card.terms} value={COPY.card.termsValue(request.daysUntilDue)} />
    </Fields>
  );
}

const asElement = (card: ReturnType<typeof Card>, what: string): CardElement => {
  const element = toCardElement(card);
  if (!element) throw new Error(`failed to build the ${what} card`);
  return element;
};

/** Sent to each admin's DM. The buttons carry the whole request; bot.ts checks the clicker. */
export function approvalCard(pending: PendingInvoice): CardElement {
  const value = encodePending(pending);
  return asElement(
    <Card title={COPY.card.title(pending.client.name)}>
      {InvoiceFields({ pending })}
      <CardText style="muted">{COPY.card.requestedBy(`<@${pending.requester.id}>`)}</CardText>
      <Actions>
        <Button id={ACTIONS.approve} style="primary" value={value}>
          {COPY.card.approve}
        </Button>
        <Button id={ACTIONS.decline} value={value}>
          {COPY.card.decline}
        </Button>
      </Actions>
    </Card>,
    'approval',
  );
}

/** An approval card after a decision: same details, no buttons, so it can't be pressed twice. */
export function resolvedCard(pending: PendingInvoice, outcome: string): CardElement {
  return asElement(
    <Card title={COPY.card.title(pending.client.name)}>
      {InvoiceFields({ pending })}
      <CardText style="muted">{outcome}</CardText>
    </Card>,
    'resolved invoice',
  );
}

/** Login button, posted in a DM. `own` is an admin's own login; `team` is the shared view-only one. */
export function connectCard(consentUrl: string, kind: keyof typeof COPY.connect) {
  const copy = COPY.connect[kind];
  return (
    <Card title={copy.title}>
      <CardText>{copy.body}</CardText>
      <Actions>
        <LinkButton url={consentUrl} style="primary">
          {copy.title}
        </LinkButton>
      </Actions>
    </Card>
  );
}
