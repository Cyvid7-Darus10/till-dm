/**
 * Text that came from people or the model must never act as Slack markup: `<!channel>` pings
 * everyone, `<@U…>` mentions someone, `<https://…|Approve>` disguises a link. Angle brackets are
 * swapped for look-alikes so the words still read the same but Slack treats them as plain text.
 */
export function plainText(text: string): string {
  return text.replace(/</g, '‹').replace(/>/g, '›');
}

/** Only https links from Airwallex are posted; anything else is dropped. */
export function safeLink(url: string): string {
  try {
    return new URL(url).protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}
