import { describe, expect, it } from 'vitest';
import { hasButtons } from '../../lib/slack/card-state';

describe('an approval card', () => {
  it('is open while it shows buttons', () => {
    expect(hasButtons({ blocks: [{ type: 'section' }, { type: 'actions' }] })).toBe(true);
  });

  it('is decided once the buttons are gone', () => {
    expect(hasButtons({ blocks: [{ type: 'section' }, { type: 'context' }] })).toBe(false);
    expect(hasButtons({ text: 'Approved by Alex.' })).toBe(false);
  });

  it('counts as decided when Slack returns something unreadable', () => {
    expect(hasButtons(null)).toBe(false);
    expect(hasButtons({ blocks: 'nope' })).toBe(false);
  });
});
