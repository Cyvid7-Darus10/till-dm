import { after } from 'next/server';
import { verifyLoginLink } from '@/lib/airwallex/login-link';
import { COPY } from '@/lib/copy';
import { log } from '@/lib/log';
import { CALLBACK_PARAM, checkApproval, finishApproval, teamLoginConnected } from '@/lib/slack/bot';

// The model and Airwallex work runs after the response; give it room to finish.
export const maxDuration = 300;

// The Airwallex sign-in returns here. Team login: confirm it. Approver login: the signed link carries
// the approval, so create the invoice, unless the request was decided in Slack meanwhile.

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  if (params.get(CALLBACK_PARAM.team) === '1') return teamCallback();
  const approved = await verifyLoginLink(params.get(CALLBACK_PARAM.token) ?? '');
  if (!approved) return page(COPY.page.invalidLink, 400);
  const requestId = approved.pending.requestId;
  try {
    const state = await checkApproval(approved);
    if (state === 'not-connected') return page(COPY.page.notConnectedYet, 409);
    if (state !== 'ready') return page(COPY.page.alreadyDecided, 409);
    // Creating takes a while; the page answers now and Till reports in Slack.
    after(() => finishApproval(approved));
    return page(COPY.page.creating);
  } catch (error: unknown) {
    log.error('failed to resume after Airwallex login', { requestId, error });
    return page(COPY.page.failed, 500);
  }
}

async function teamCallback(): Promise<Response> {
  try {
    return (await teamLoginConnected()) ? page(COPY.page.teamConnected) : page(COPY.page.notConnectedYet, 409);
  } catch (error: unknown) {
    log.error('failed to check the team Airwallex login', { error });
    return page(COPY.page.failed, 500);
  }
}

// The signed link sits in this page's URL: keep it out of caches and referrers.
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
};

/** A minimal branded page. `message` is always one of Till's own strings, never user input. */
function page(message: string, status = 200): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Till</title>
<body style="font:16px system-ui;background:#F7F5EF;color:#0F5132;display:grid;place-items:center;min-height:90vh;margin:0 16px">
<p>${message}</p></body>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}
