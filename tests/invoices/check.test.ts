import { describe, expect, it, vi } from 'vitest';
import type { AirwallexSession } from '../../lib/airwallex/session';
import { TOOL } from '../../lib/airwallex/tool-policy';
import { checkCreatedInvoice, findMismatches } from '../../lib/invoices/check';
import type { InvoiceRequest } from '../../lib/invoices/request';

const approved: InvoiceRequest = {
  customer: 'Parkside Dental',
  description: 'Website redesign',
  amount: 3950,
  currency: 'USD',
  daysUntilDue: 30,
};

const customer = { id: 'cus_123', name: 'Parkside Dental Group' };
const matching = { status: 'FINALIZED', currency: 'USD', totalAmount: 3950, customerId: 'cus_123' };

describe('checking a created invoice against the approval', () => {
  it('passes when everything matches', () => {
    expect(findMismatches(approved, customer, matching)).toEqual([]);
  });

  it('flags a draft, a different currency, amount or client', () => {
    const problems = findMismatches(approved, customer, { status: 'DRAFT', currency: 'EUR', totalAmount: 39500, customerId: 'cus_999' });
    expect(problems).toHaveLength(4);
  });

  it('ignores rounding below half a cent', () => {
    expect(findMismatches(approved, customer, { ...matching, totalAmount: 3950.004 })).toEqual([]);
    expect(findMismatches(approved, customer, { ...matching, totalAmount: 3950.01 })).toHaveLength(1);
  });
});

function fakeAirwallex(invoice: Record<string, unknown>) {
  const call = vi.fn(async (toolName: string) => {
    if (toolName === TOOL.getInvoice) return invoice;
    if (toolName === TOOL.voidInvoice) return { ...invoice, status: 'VOIDED' };
    throw new Error(`unexpected tool ${toolName}`);
  });
  const session: AirwallexSession = { tools: {}, call, close: async () => {} };
  return { session, call };
}

const invoice = {
  id: 'inv_123',
  number: 'INV-0042',
  status: 'FINALIZED',
  currency: 'USD',
  total_amount: 3950,
  billing_customer_id: 'cus_123',
  hosted_url: 'https://example.com/inv_123',
};

describe('reading the invoice back from Airwallex', () => {
  it('returns the number and link when it matches', async () => {
    const { session, call } = fakeAirwallex(invoice);
    await expect(checkCreatedInvoice(session, 'inv_123', approved, customer)).resolves.toEqual({
      ok: true,
      number: 'INV-0042',
      url: 'https://example.com/inv_123',
    });
    expect(call).toHaveBeenCalledWith(TOOL.getInvoice, { invoice_id: 'inv_123' });
    expect(call).not.toHaveBeenCalledWith(TOOL.voidInvoice, expect.anything());
  });

  it('voids a finalized invoice billed to another client', async () => {
    const { session, call } = fakeAirwallex({ ...invoice, billing_customer_id: 'cus_999' });
    const result = await checkCreatedInvoice(session, 'inv_123', approved, customer);
    expect(result.ok).toBe(false);
    expect(call).toHaveBeenCalledWith(TOOL.voidInvoice, { invoice_id: 'inv_123' });
  });

  it('reports a draft without trying to void it', async () => {
    const { session, call } = fakeAirwallex({ ...invoice, status: 'DRAFT' });
    expect((await checkCreatedInvoice(session, 'inv_123', approved, customer)).ok).toBe(false);
    expect(call).not.toHaveBeenCalledWith(TOOL.voidInvoice, expect.anything());
  });

  it('falls back to the id when the invoice has no number', async () => {
    const { number: _number, hosted_url: _url, ...bare } = invoice;
    const { session } = fakeAirwallex(bare);
    await expect(checkCreatedInvoice(session, 'inv_123', approved, customer)).resolves.toEqual({ ok: true, number: 'inv_123', url: '' });
  });
});
