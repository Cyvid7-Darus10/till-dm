import { describe, expect, it } from 'vitest';
import { readConfig } from '../lib/config';

const required = {
  TILL_KMS_ISSUER_ID: '00000000-0000-4000-8000-000000000000',
  TILL_FINANCE_ADMIN_SLACK_IDS: 'UADMIN0001',
};

function captureError(run: () => unknown): string {
  try {
    run();
  } catch (error: unknown) {
    return String(error);
  }
  throw new Error('expected an error');
}

describe('configuration', () => {
  it('needs only the deployment-specific ids; everything else has a default', () => {
    const config = readConfig(required);
    expect(config.financeAdminSlackIds).toEqual(['UADMIN0001']);
    expect(config.teamLoginId).toBe('finance-team');
    expect(config.loginLinkTtlSeconds).toBe(900);
  });

  it('reads a comma-separated admin list, ignoring spaces and blanks', () => {
    const config = readConfig({ ...required, TILL_FINANCE_ADMIN_SLACK_IDS: ' UADMIN0001, UADMIN0002 ,' });
    expect(config.financeAdminSlackIds).toEqual(['UADMIN0001', 'UADMIN0002']);
  });

  it('turns numeric settings from text into numbers', () => {
    expect(readConfig({ ...required, TILL_HISTORY_LIMIT: '12' }).historyLimit).toBe(12);
  });

  it('treats an empty variable as unset', () => {
    expect(readConfig({ ...required, TILL_MODEL: '' }).model).toBe('openai/gpt-5');
  });

  it('names every missing or invalid variable in one error', () => {
    const error = captureError(() => readConfig({ TILL_HISTORY_LIMIT: '0' }));
    for (const name of ['TILL_FINANCE_ADMIN_SLACK_IDS', 'TILL_KMS_ISSUER_ID', 'TILL_HISTORY_LIMIT']) {
      expect(error).toContain(name);
    }
  });

  it('rejects an admin entry that is not a Slack user id', () => {
    expect(() => readConfig({ ...required, TILL_FINANCE_ADMIN_SLACK_IDS: 'alex@example.com' })).toThrow(/not a Slack user id/);
  });
});

describe('the finance team', () => {
  it('defaults to the admins only', () => {
    expect(readConfig(required).financeMemberSlackIds).toEqual([]);
  });

  it('accepts a comma-separated member list and rejects anything that is not a user id', () => {
    expect(readConfig({ ...required, TILL_FINANCE_MEMBER_SLACK_IDS: 'UMEMBER001, UMEMBER002' }).financeMemberSlackIds).toEqual([
      'UMEMBER001',
      'UMEMBER002',
    ]);
    expect(() => readConfig({ ...required, TILL_FINANCE_MEMBER_SLACK_IDS: '#finance' })).toThrow(/TILL_FINANCE_MEMBER_SLACK_IDS/);
  });

  it('caps admins at one approval card each, within the Slack button size', () => {
    const six = ['UADMIN0001', 'UADMIN0002', 'UADMIN0003', 'UADMIN0004', 'UADMIN0005', 'UADMIN0006'].join(',');
    expect(() => readConfig({ ...required, TILL_FINANCE_ADMIN_SLACK_IDS: six })).toThrow(/at most 5 admins/);
  });
});
