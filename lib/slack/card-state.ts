import { z } from 'zod';

// Slack's own copy of a message: an approval card has an `actions` block until someone decides.
const slackMessageSchema = z.object({ blocks: z.array(z.object({ type: z.string() })).optional() });

/** True when a raw Slack message still shows buttons. Anything unreadable counts as closed. */
export function hasButtons(raw: unknown): boolean {
  const parsed = slackMessageSchema.safeParse(raw);
  return parsed.success && (parsed.data.blocks ?? []).some((block) => block.type === 'actions');
}
