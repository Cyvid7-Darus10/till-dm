import { z } from 'zod';
import type { AirwallexSession } from '../airwallex/session';
import { TOOL } from '../airwallex/tool-policy';

/**
 * Picks the one Airwallex billing customer an invoice is for, in code, before the admin is asked.
 * The approval card names that customer, and the created invoice is checked against its id.
 */

const CUSTOMERS_PER_PAGE = 100;
const COMPANY_SUFFIXES = /\b(ltd|limited|inc|incorporated|llc|co|corp|corporation|gmbh|pte|plc)\b\.?/g;

// Airwallex allows clients without a name; those can never match a request, so they are skipped.
const customerListSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string().optional() })),
  has_more: z.boolean().optional(),
});

export interface Customer {
  id: string;
  name: string;
}

export type CustomerMatch = { ok: true; customer: Customer } | { ok: false; problem: string };

/** Lowercase, without punctuation or a trailing company type, so "Northwind Trading Ltd." equals "northwind trading". */
export const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(COMPANY_SUFFIXES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * An exact name match wins. Otherwise the name may be the start of exactly one customer's name
 * ("Parkside Dental" for "Parkside Dental Group"). Anything else is refused rather than guessed.
 */
export function pickCustomer(customers: readonly Customer[], requested: string, complete = true): CustomerMatch {
  const wanted = normalizeName(requested);
  if (!wanted) return { ok: false, problem: 'The request has no client name.' };
  const exact = customers.filter((customer) => normalizeName(customer.name) === wanted);
  if (exact.length === 1) return { ok: true, customer: exact[0] };
  // Several exact matches stay ambiguous. A prefix must end at a word: "Park" never finds "Parkside".
  const candidates = exact.length > 0 ? exact : customers.filter((customer) => normalizeName(customer.name).startsWith(`${wanted} `));
  // A partial name is only safe when every client was seen: the exact one could be on a later page.
  if (candidates.length === 1 && complete) return { ok: true, customer: candidates[0] };
  if (candidates.length === 1) return { ok: false, problem: `Ask again with the client's full name, ${candidates[0].name}.` };
  if (candidates.length === 0) return { ok: false, problem: `There is no client named ${requested} in Airwallex.` };
  const names = candidates.map((customer) => customer.name).join(', ');
  return { ok: false, problem: `More than one client matches ${requested} (${names}). Ask again with the full name.` };
}

/** Looks the requested client up in Airwallex. */
export async function findCustomer(airwallex: AirwallexSession, requested: string): Promise<CustomerMatch> {
  const { items, has_more } = customerListSchema.parse(await airwallex.call(TOOL.listCustomers, { page_size: CUSTOMERS_PER_PAGE }));
  const named = items.flatMap(({ id, name }) => (name ? [{ id, name }] : []));
  return pickCustomer(named, requested, has_more !== true);
}
