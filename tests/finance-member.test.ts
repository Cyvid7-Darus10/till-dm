import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('TILL_FINANCE_ADMIN_SLACK_IDS', 'UADMIN0001');
vi.stubEnv('TILL_FINANCE_MEMBER_SLACK_IDS', 'UMEMBER001');
const { isFinanceAdmin, isFinanceMember } = await import('../lib/config');

describe('who Till talks to', () => {
  it('answers listed members and every admin', () => {
    expect(isFinanceMember('UMEMBER001')).toBe(true);
    expect(isFinanceMember('UADMIN0001')).toBe(true);
  });

  it('turns away everyone else', () => {
    expect(isFinanceMember('UOUTSIDE01')).toBe(false);
  });

  it('lets only admins approve', () => {
    expect(isFinanceAdmin('UADMIN0001')).toBe(true);
    expect(isFinanceAdmin('UMEMBER001')).toBe(false);
  });
});
