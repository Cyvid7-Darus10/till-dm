import { after } from 'next/server';
import { verifyLoginLink } from '@/lib/airwallex/login-link';
import { COPY } from '@/lib/copy';
import { log } from '@/lib/log';
import { approverConnected, CALLBACK_PARAM, finishApproval, teamLoginConnected } from '@/lib/slack/bot';

// The Airwallex sign-in returns here. Team login: confirm it. Approver login: the signed link
// carries the approved invoice, so create it once the login is connected.

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  if (params.get(CALLBACK_PARAM.team) === '1') return teamCallback();
  const approved = await verifyLoginLink(params.get(CALLBACK_PARAM.token) ?? '');
  if (!approved) return page(COPY.page.invalidLink, 400);
  const requestId = approved.pending.requestId;
  try {
    if (!(await approverConnected(approved))) return page(COPY.page.notConnectedYet, 409);
    // Creating takes a while; the page answers now and Till reports in Slack.
    after(() => finishApproval(approved).catch((error: unknown) => log.error('failed to finish approval', { requestId, error })));
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
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
};

/** A minimal branded page. `message` is always one of Till's own strings, never user input. */
function page(message: string, status = 200): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Till</title>
<body style="font:16px system-ui;background:#F7F5EF;color:#0F5132;display:grid;place-items:center;min-height:90vh;margin:0 16px">
<p>${message}</p></body>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}
