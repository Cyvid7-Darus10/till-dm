import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Placeholder values so modules that read config at import time can load. Not real ids.
    env: {
      TILL_KMS_ISSUER_ID: '00000000-0000-4000-8000-000000000000',
      TILL_FINANCE_ADMIN_SLACK_IDS: 'UADMIN0001',
    },
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      // Glue around Slack, the model and Airwallex: covered by the live end-to-end run, not unit tests.
      exclude: ['lib/slack/bot.ts', 'lib/slack/cards.tsx', 'lib/agent/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
