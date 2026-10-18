import { describe, expect, it } from 'vitest';
import { parseApiResponse } from '../../lib/airwallex/session';

const result = (text: string, isError = false) => ({ isError, content: [{ type: 'text', text }] });

describe('Airwallex tool results', () => {
  it('yield the JSON inside the api_response tags', () => {
    const text = 'Here you go.\n<api_response_ab12>\n{"id":"inv_1","status":"FINALIZED"}\n</api_response_ab12>';
    expect(parseApiResponse('retrieve_billing_invoice', result(text))).toEqual({ id: 'inv_1', status: 'FINALIZED' });
  });

  it('throw, naming the tool, when the call failed', () => {
    expect(() => parseApiResponse('void_billing_invoice', result('permission denied', true))).toThrow(/void_billing_invoice/);
  });

  it('throw when there is no payload to read', () => {
    expect(() => parseApiResponse('list_billing_customers', result('no tags here'))).toThrow(/list_billing_customers/);
    expect(() => parseApiResponse('list_billing_customers', undefined)).toThrow();
  });
});
