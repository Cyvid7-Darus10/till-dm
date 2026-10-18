import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOGIN_LINK_AUDIENCE, verifyLoginLink } from '../../lib/airwallex/login-link';
import { approved } from '../fixtures';

// Stands in for Vercel KMS: a local key pair, verified the same way as the real JWKS.

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let kms: KeyPair;
let attacker: KeyPair;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  kms = await generateKeyPair('ES256');
  attacker = await generateKeyPair('ES256');
  keys = async () => kms.publicKey;
});

const sign = (privateKey: CryptoKey, claims: Record<string, unknown>, expiresIn = '15m') =>
  new SignJWT(claims).setProtectedHeader({ alg: 'ES256' }).setIssuedAt().setExpirationTime(expiresIn).sign(privateKey);

describe('Airwallex login links', () => {
  it('carry the approved invoice when signed by the issuer', async () => {
    const token = await sign(kms.privateKey, { aud: LOGIN_LINK_AUDIENCE, approved });
    expect(await verifyLoginLink(token, keys)).toEqual(approved);
  });

  it('are rejected when signed by anyone else', async () => {
    const token = await sign(attacker.privateKey, { aud: LOGIN_LINK_AUDIENCE, approved });
    expect(await verifyLoginLink(token, keys)).toBeNull();
  });

  it('are rejected once expired', async () => {
    const token = await sign(kms.privateKey, { aud: LOGIN_LINK_AUDIENCE, approved }, '-1m');
    expect(await verifyLoginLink(token, keys)).toBeNull();
  });

  it('are rejected when minted for another purpose', async () => {
    const token = await sign(kms.privateKey, { aud: 'something-else', approved });
    expect(await verifyLoginLink(token, keys)).toBeNull();
  });

  it('are rejected when the approval inside breaks the schema', async () => {
    const tampered = { ...approved, approver: { id: 'not an id', name: 'Mallory' } };
    const token = await sign(kms.privateKey, { aud: LOGIN_LINK_AUDIENCE, approved: tampered });
    expect(await verifyLoginLink(token, keys)).toBeNull();
  });

  it('are rejected when empty or garbage', async () => {
    expect(await verifyLoginLink('', keys)).toBeNull();
    expect(await verifyLoginLink('not.a.jwt', keys)).toBeNull();
  });
});
