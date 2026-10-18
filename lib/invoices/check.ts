import { z } from 'zod';
import type { AirwallexSession } from '../airwallex/session';
import { TOOL } from '../airwallex/tool-policy';
import type { Customer } from './customer-match';
import type { InvoiceRequest } from './request';

/**
 * The model creates the invoice; Till's code reads it back from Airwallex and compares it with the
 * approval. A mismatch is voided, never left in place.
 */

// Half a cent: absorbs floating-point rounding, nothing more.
const AMOUNT_TOLERANCE = 0.005;
const FINALIZED = 'FINALIZED';

const invoiceSchema = z.object({
  id: z.string(),
  number: z.string().optional(),
  status: z.string(),
  currency: z.string(),
  total_amount: z.number(),
  billing_customer_id: z.string(),
  hosted_url: z.string().optional(),
});

export interface CreatedInvoice {
  status: string;
  currency: string;
  totalAmount: number;
  customerId: string;
}

/** Lists every way the created invoice differs from the approved request. Empty means it matches. */
export function findMismatches(approved: InvoiceRequest, customer: Customer, created: CreatedInvoice): string[] {
  const problems: string[] = [];
  if (created.status !== FINALIZED) problems.push(`status is ${created.status}, not finalized`);
  if (created.currency !== approved.currency) problems.push(`currency is ${created.currency}, approved ${approved.currency}`);
  if (Math.abs(created.totalAmount - approved.amount) > AMOUNT_TOLERANCE) {
    problems.push(`total is ${created.totalAmount}, approved ${approved.amount}`);
  }
  if (created.customerId !== customer.id) problems.push(`it is billed to another client, not ${customer.name}`);
  return problems;
}

export type CheckResult = { ok: true; number: string; url: string } | { ok: false; problem: string };

/** Reads the invoice back from Airwallex, compares it with the approval, and voids it on any mismatch. */
export async function checkCreatedInvoice(
  airwallex: AirwallexSession,
  invoiceId: string,
  approved: InvoiceRequest,
  customer: Customer,
): Promise<CheckResult> {
  const invoice = invoiceSchema.parse(await airwallex.call(TOOL.getInvoice, { invoice_id: invoiceId }));
  const problems = findMismatches(approved, customer, {
    status: invoice.status,
    currency: invoice.currency,
    totalAmount: invoice.total_amount,
    customerId: invoice.billing_customer_id,
  });
  if (problems.length === 0) return { ok: true, number: invoice.number ?? invoice.id, url: invoice.hosted_url ?? '' };
  // Drafts are never sent, so only a finalized invoice needs voiding.
  if (invoice.status === FINALIZED) await airwallex.call(TOOL.voidInvoice, { invoice_id: invoice.id });
  return { ok: false, problem: `The invoice didn't match what was approved (${problems.join('; ')}), so I voided it.` };
}
