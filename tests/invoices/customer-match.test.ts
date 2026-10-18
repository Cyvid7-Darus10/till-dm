import { describe, expect, it, vi } from 'vitest';
import type { AirwallexSession } from '../../lib/airwallex/session';
import { TOOL } from '../../lib/airwallex/tool-policy';
import { findCustomer, normalizeName, pickCustomer } from '../../lib/invoices/customer-match';

const customers = [
  { id: 'cus_1', name: 'Northwind Trading Ltd.' },
  { id: 'cus_2', name: 'Parkside Dental Group' },
  { id: 'cus_3', name: 'Acme' },
  { id: 'cus_4', name: 'Acme Holdings' },
  { id: 'cus_5', name: 'Ashby & Rowe' },
  { id: 'cus_6', name: 'Ashby & Rowe Studio' },
];

describe('client names', () => {
  it('compare without case, punctuation or a company type', () => {
    expect(normalizeName('Northwind Trading Ltd.')).toBe('northwind trading');
    expect(normalizeName('  ASHBY & ROWE ')).toBe('ashby rowe');
  });
});

describe('picking the client for an invoice', () => {
  it('takes an exact match, even when longer names share its start', () => {
    expect(pickCustomer(customers, 'acme')).toEqual({ ok: true, customer: { id: 'cus_3', name: 'Acme' } });
    expect(pickCustomer(customers, 'Northwind Trading')).toMatchObject({ ok: true, customer: { id: 'cus_1' } });
  });

  it('takes the one client whose name starts with what was asked', () => {
    expect(pickCustomer(customers, 'Parkside Dental')).toMatchObject({ ok: true, customer: { id: 'cus_2' } });
  });

  it('refuses a name that only matches part of a word', () => {
    expect(pickCustomer(customers, 'Park').ok).toBe(false);
  });

  it('refuses when no client matches', () => {
    expect(pickCustomer(customers, 'Globex')).toEqual({ ok: false, problem: 'There is no client named Globex in Airwallex.' });
  });

  it('refuses to guess between several clients', () => {
    const match = pickCustomer([...customers, { id: 'cus_7', name: 'Parkside Dental Clinic' }], 'Parkside Dental');
    expect(match.ok).toBe(false);
    expect(match.ok ? '' : match.problem).toContain('More than one client');
  });

  it('refuses an empty name', () => {
    expect(pickCustomer(customers, 'Ltd.').ok).toBe(false);
  });
});

describe('a partial name when Airwallex has more clients than one page', () => {
  it('is refused, because the exact client could be on a later page', () => {
    expect(pickCustomer(customers, 'Parkside Dental', false)).toEqual({
      ok: false,
      problem: "Ask again with the client's full name, Parkside Dental Group.",
    });
  });

  it('still allows an exact name', () => {
    expect(pickCustomer(customers, 'Parkside Dental Group', false)).toMatchObject({ ok: true, customer: { id: 'cus_2' } });
  });
});

describe('looking the client up in Airwallex', () => {
  it('refuses a partial name when the list has more pages', async () => {
    const call = vi.fn(async () => ({ items: customers, has_more: true }));
    const session: AirwallexSession = { tools: {}, call, close: async () => {} };
    expect((await findCustomer(session, 'Parkside Dental')).ok).toBe(false);
  });

  it('lists customers and picks one, skipping clients without a name', async () => {
    const call = vi.fn(async () => ({ items: [{ id: 'cus_0' }, ...customers] }));
    const session: AirwallexSession = { tools: {}, call, close: async () => {} };
    await expect(findCustomer(session, 'Parkside Dental')).resolves.toMatchObject({ ok: true, customer: { id: 'cus_2' } });
    expect(call).toHaveBeenCalledWith(TOOL.listCustomers, { page_size: 100 });
  });
});
