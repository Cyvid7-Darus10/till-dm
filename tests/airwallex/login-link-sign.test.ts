import { describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/kms', () => ({ signJWT: vi.fn(async () => ({ token: 'signed.jwt.token' })) }));

const { signJWT } = await import('@vercel/kms');
const { LOGIN_LINK_AUDIENCE, signLoginLink } = await import('../../lib/airwallex/login-link');
const { config } = await import('../../lib/config');
const { approved } = await import('../fixtures');

describe('signing a login link', () => {
  it('asks Vercel KMS for a short-lived token for this purpose only', async () => {
    await expect(signLoginLink(approved)).resolves.toBe('signed.jwt.token');
    expect(signJWT).toHaveBeenCalledWith({
      issuerId: config.kmsIssuerId,
      claims: { aud: LOGIN_LINK_AUDIENCE, approved },
      ttl: config.loginLinkTtlSeconds,
    });
  });
});
