// Slack sends each channel mention twice (app_mention and a channel message) and resends events it
// thinks timed out. With no shared state to de-duplicate, Till keeps DMs and app_mention and drops the rest.

interface SlackEnvelope {
  event?: { type?: string; channel_type?: string };
}

/** Why this Slack delivery should be acknowledged without handling, or null to handle it. */
export async function duplicateReason(request: Request): Promise<string | null> {
  if (request.headers.get('x-slack-retry-num')) return 'slack retry';
  if (!request.headers.get('content-type')?.includes('application/json')) return null;
  try {
    const { event } = (await request.clone().json()) as SlackEnvelope;
    if (event?.type === 'message' && event.channel_type !== 'im') return 'channel message (handled as app_mention)';
  } catch {
    return null;
  }
  return null;
}
