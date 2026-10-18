// Structured logs, one JSON line each. Never pass tokens or message bodies in context.

type Level = 'info' | 'warn' | 'error';

function describe(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, cause: describe(value.cause) };
  return value;
}

function write(level: Level, message: string, context: Record<string, unknown> = {}): void {
  const fields = Object.fromEntries(Object.entries(context).map(([key, value]) => [key, describe(value)]));
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...fields });
  if (level === 'error') console.error(line);
  else console.info(line);
}

export const log = {
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
};
