import { describe, expect, it } from 'vitest';
import { allowedTools } from '../../lib/airwallex/tool-policy';

const read = (name: string) => ({ name, annotations: { readOnlyHint: true } });
const write = (name: string) => ({ name, annotations: { readOnlyHint: false } });

const tools = [
  read('list_balances'),
  read('list_billing_invoices'),
  write('create_billing_invoice'),
  write('finalize_billing_invoice'),
  write('create_transfer'),
  write('create_payout'),
  write('simulate_create_deposit'),
  { name: 'unannotated_tool' },
];

const names = (list: { name: string }[]) => list.map((t) => t.name);

describe('tools Till can see', () => {
  it('with the team login are read-only tools only', () => {
    expect(names(allowedTools(tools, 'view'))).toEqual(['list_balances', 'list_billing_invoices']);
  });

  it("with an admin's own login include invoice writes", () => {
    expect(names(allowedTools(tools, 'create'))).toEqual(expect.arrayContaining(['create_billing_invoice', 'finalize_billing_invoice']));
  });

  it('never include money movement or simulations, whatever the login', () => {
    for (const access of ['view', 'create'] as const) {
      const allowed = names(allowedTools(tools, access));
      expect(allowed).not.toContain('create_transfer');
      expect(allowed).not.toContain('create_payout');
      expect(allowed).not.toContain('simulate_create_deposit');
    }
  });

  it('treat a tool without annotations as a write', () => {
    expect(names(allowedTools(tools, 'view'))).not.toContain('unannotated_tool');
  });
});
