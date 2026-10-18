import { describe, expect, it } from 'vitest';
import { forCreating, forQuestions } from '../../lib/airwallex/logins';

describe('whose Airwallex login', () => {
  it('is one shared team login for questions', () => {
    expect(forQuestions()).toEqual({ type: 'user', id: 'finance-team' });
  });

  it("is the Slack user's own login for creating", () => {
    expect(forCreating('UADMIN0001')).toEqual({ type: 'user', id: 'UADMIN0001' });
  });
});
