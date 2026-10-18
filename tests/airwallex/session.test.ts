import { beforeEach, describe, expect, it, vi } from 'vitest';

class UserAuthorizationRequiredError extends Error {}

const connect = vi.hoisted(() => ({ getTokenResponse: vi.fn(), getConnectorMetadata: vi.fn() }));
const mcp = vi.hoisted(() => ({ createMCPClient: vi.fn() }));

vi.mock('@vercel/connect', () => ({ ...connect, UserAuthorizationRequiredError }));
vi.mock('@vercel/connect/ai-sdk', () => ({ connectAuthProvider: vi.fn(() => ({})) }));
vi.mock('@ai-sdk/mcp', () => mcp);

const { isConnected, openAirwallex } = await import('../../lib/airwallex/session');

const login = { type: 'user', id: 'finance-team' } as const;
const scopes = ['r:org_action:billing.invoice_view'];

beforeEach(() => vi.clearAllMocks());

describe('whether a login is connected', () => {
  it('is yes when Vercel Connect has a token for those scopes', async () => {
    connect.getTokenResponse.mockResolvedValue({ token: 'x' });
    await expect(isConnected(login, scopes)).resolves.toBe(true);
  });

  it('is no when the person still has to sign in', async () => {
    connect.getTokenResponse.mockRejectedValue(new UserAuthorizationRequiredError());
    await expect(isConnected(login, scopes)).resolves.toBe(false);
  });

  it('throws, naming the login, on any other failure', async () => {
    connect.getTokenResponse.mockRejectedValue(new Error('network down'));
    await expect(isConnected(login, scopes)).rejects.toThrow(/finance-team/);
  });
});

describe('an Airwallex session', () => {
  const listed = {
    tools: [
      { name: 'list_billing_invoices', annotations: { readOnlyHint: true } },
      { name: 'create_billing_invoice', annotations: { readOnlyHint: false } },
    ],
  };
  const execute = vi.fn(async () => ({ content: [{ type: 'text', text: '<api_response_1>{"ok":true}</api_response_1>' }] }));

  beforeEach(() => {
    connect.getConnectorMetadata.mockResolvedValue({ clientUrl: 'https://mcp.example.com' });
    mcp.createMCPClient.mockResolvedValue({
      listTools: async () => listed,
      toolsFromDefinitions: (defs: typeof listed) => Object.fromEntries(defs.tools.map((t) => [t.name, { execute }])),
      close: vi.fn(),
    });
  });

  it('only loads the tools its access allows', async () => {
    const session = await openAirwallex(login, scopes, 'view');
    expect(Object.keys(session.tools)).toEqual(['list_billing_invoices']);
  });

  it('calls a tool directly and returns its parsed result', async () => {
    const session = await openAirwallex(login, scopes, 'view');
    await expect(session.call('list_billing_invoices', {})).resolves.toEqual({ ok: true });
  });

  it('refuses a tool the login was not given', async () => {
    const session = await openAirwallex(login, scopes, 'view');
    await expect(session.call('create_billing_invoice', {})).rejects.toThrow(/not available/);
  });
});
