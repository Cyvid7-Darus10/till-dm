import { after } from 'next/server';
import { log } from '@/lib/log';
import { bot } from '@/lib/slack/bot';
import { duplicateReason } from '@/lib/slack/events';

// The model and Airwallex work runs after the response; give it room to finish.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  // Acknowledge duplicates with 200 so Slack stops resending them.
  const skipped = await duplicateReason(request);
  if (skipped) {
    log.info('skipped slack event', { reason: skipped });
    return new Response(null, { status: 200 });
  }
  // Slack wants a reply within 3 seconds; the model's work continues after the response.
  return bot.webhooks.slack(request, { waitUntil: (task) => after(() => task) });
}
