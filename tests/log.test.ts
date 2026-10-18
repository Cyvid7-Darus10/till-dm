import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../lib/log';

afterEach(() => vi.restoreAllMocks());

const lastLine = (spy: { mock: { calls: unknown[][] } }) => JSON.parse(String(spy.mock.calls.at(-1)?.[0]));

describe('logs', () => {
  it('are one JSON line with timestamp, level and message', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    log.info('skipped slack event', { reason: 'slack retry' });
    const line = lastLine(info);
    expect(line).toMatchObject({ level: 'info', message: 'skipped slack event', reason: 'slack retry' });
    expect(new Date(line.timestamp).toISOString()).toBe(line.timestamp);
  });

  it('send warnings to info and errors to stderr', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.warn('slow reply');
    log.error('failed');
    expect(lastLine(info).level).toBe('warn');
    expect(lastLine(error).level).toBe('error');
  });

  it('describe errors with their cause instead of dropping them', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('failed to create invoice', { error: new Error('outer', { cause: new Error('inner') }) });
    expect(lastLine(error).error).toEqual({
      name: 'Error',
      message: 'outer',
      cause: { name: 'Error', message: 'inner', cause: undefined },
    });
  });
});
