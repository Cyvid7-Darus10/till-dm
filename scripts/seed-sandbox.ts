// Seeds an Airwallex SANDBOX account with three example clients, each with one unpaid invoice,
// so Till has something to talk about. Safe to re-run: it reuses clients by name and skips any
// client that already has invoices. It never moves money.
//
// Usage: npm run seed -- [--dry-run]
// The first run prints a link to sign in to Airwallex as the "seed" login; open it, then run again.
import { randomUUID } from 'node:crypto';
import { createMCPClient } from '@ai-sdk/mcp';
import { getConnectorMetadata, startAuthorization } from '@vercel/connect';
import { connectAuthProvider } from '@vercel/connect/ai-sdk';
import { isConnected, parseApiResponse } from '../lib/airwallex/session';
import { SCOPES } from '../lib/airwallex/tool-policy';
import { config } from '../lib/config';

const SEED_LOGIN = { type: 'user', id: 'seed' } as const;
const DRY_RUN = process.argv.includes('--dry-run');

// Airwallex rejects due dates in the past, so the first client is due today and turns overdue tomorrow.
const CLIENTS = [
  { name: 'Northwind Trading Ltd.', currency: 'EUR', country: 'DE', item: 'Brand refresh, phase 1', amount: 6200, daysUntilDue: 0 },
  { name: 'Parkside Dental Group', currency: 'USD', country: 'US', item: 'Website redesign', amount: 3950, daysUntilDue: 30 },
  { name: 'Ashby & Rowe', currency: 'GBP', country: 'GB', item: 'Packaging design', amount: 2400, daysUntilDue: 14 },
];

interface Listed<T> {
  items: T[];
}
interface Entity {
  id: string;
  name?: string;
  number?: string;
  status?: string;
}

if (!(await isConnected(SEED_LOGIN, SCOPES.creating))) {
  const { url } = await startAuthorization(config.airwallexConnector, { subject: SEED_LOGIN, scopes: [...SCOPES.creating] });
  console.info(`Sign in to your Airwallex sandbox first, then run this again:\n${url}`);
  process.exit(1);
}

const meta = await getConnectorMetadata(config.airwallexConnector);
const serverUrl = meta.clientUrl ?? (typeof meta.vendor?.serverUrl === 'string' ? meta.vendor.serverUrl : undefined);
if (!serverUrl) throw new Error(`connector ${config.airwallexConnector} has no server url`);

const client = await createMCPClient({
  transport: {
    type: 'http',
    url: serverUrl,
    authProvider: connectAuthProvider(
      config.airwallexConnector,
      { subject: SEED_LOGIN, scopes: [...SCOPES.creating] },
      { consent: 'eager' },
    ),
  },
});
const tools = await client.tools();

async function call<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
  const tool = tools[toolName];
  if (!tool?.execute) throw new Error(`Airwallex tool ${toolName} is not available to the seed login`);
  return parseApiResponse(toolName, await tool.execute(args, { toolCallId: randomUUID(), messages: [] })) as T;
}

try {
  const { items: customers } = await call<Listed<Entity>>('list_billing_customers', { page_size: 100 });
  for (const seed of CLIENTS) {
    const existing = customers.find((customer) => customer.name === seed.name);
    if (existing) {
      const { items: invoices } = await call<Listed<Entity>>('list_billing_invoices', { billing_customer_id: existing.id, page_size: 10 });
      if (invoices.length > 0) {
        console.info(`skip  ${seed.name}: already has ${invoices.length} invoice(s)`);
        continue;
      }
    }
    if (DRY_RUN) {
      console.info(`would ${existing ? 'reuse' : 'create'} ${seed.name} and invoice ${seed.currency} ${seed.amount}`);
      continue;
    }
    const customer =
      existing ??
      (await call<Entity>('create_billing_customer', {
        request_id: randomUUID(),
        name: seed.name,
        customer_type: 'BUSINESS',
        default_billing_currency: seed.currency,
        address: { country_code: seed.country },
      }));
    const product = await call<Entity>('create_billing_product', { request_id: randomUUID(), name: seed.item });
    const invoice = await call<Entity>('create_billing_invoice', {
      request_id: randomUUID(),
      billing_customer_id: customer.id,
      currency: seed.currency,
      collection_method: 'OUT_OF_BAND',
      days_until_due: seed.daysUntilDue,
    });
    await call('add_billing_invoice_line_items', {
      request_id: randomUUID(),
      invoice_id: invoice.id,
      line_items: [{ price: { product_id: product.id, pricing_model: 'FLAT', flat_amount: seed.amount }, quantity: 1 }],
    });
    const finalized = await call<Entity>('finalize_billing_invoice', { invoice_id: invoice.id });
    console.info(`made  ${seed.name}: invoice ${finalized.number ?? finalized.id}, ${finalized.status}`);
  }
} finally {
  await client.close();
}
