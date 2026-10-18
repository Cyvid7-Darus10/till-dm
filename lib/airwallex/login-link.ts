import { signJWT } from '@vercel/kms';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { config } from '../config';
import { type ApprovedInvoice, approvedInvoiceSchema } from '../invoices/request';

/**
 * The link back from the Airwallex sign-in carries the approved invoice, and following it creates the
 * invoice. Vercel KMS signs it, so the project holds no secret, and it expires, so an old or forged
 * link can't create anything.
 */

/** Marks a token as a Till login link, so a token Vercel KMS signed for anything else is refused. */
export const LOGIN_LINK_AUDIENCE = 'till-dm:airwallex-login';

const jwksUrl = (issuerId: string): URL => new URL(`https://kms.vercel.com/${issuerId}/jwks.json`);

// Built once per instance; jose caches the fetched keys.
let keySet: JWTVerifyGetKey | undefined;
const defaultKeySet = (): JWTVerifyGetKey => {
  keySet ??= createRemoteJWKSet(jwksUrl(config.kmsIssuerId));
  return keySet;
};

/** Signs an approved invoice into a short-lived token for the Airwallex login callback. */
export async function signLoginLink(approved: ApprovedInvoice): Promise<string> {
  const { token } = await signJWT({
    issuerId: config.kmsIssuerId,
    claims: { aud: LOGIN_LINK_AUDIENCE, approved },
    ttl: config.loginLinkTtlSeconds,
  });
  return token;
}

/** Verifies a login-link token. Returns the approved invoice, or null if forged, expired or malformed. */
export async function verifyLoginLink(token: string, keys: JWTVerifyGetKey = defaultKeySet()): Promise<ApprovedInvoice | null> {
  try {
    const { payload } = await jwtVerify(token, keys, { audience: LOGIN_LINK_AUDIENCE });
    const parsed = approvedInvoiceSchema.safeParse(payload.approved);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
