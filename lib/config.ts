import { z } from 'zod';
import { MAX_APPROVAL_CARDS } from './invoices/request';
import { SLACK_USER_ID } from './slack/user-id';

/**
 * Every name, id and limit Till uses, validated once at startup. None are secrets.
 * TILL_KMS_ISSUER_ID and TILL_FINANCE_ADMIN_SLACK_IDS are required; the rest have defaults.
 */

const commaList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const slackUserIdList = z.array(z.string().regex(SLACK_USER_ID, 'not a Slack user id'));

const slackUserIds = z.string({ error: 'required (comma-separated Slack user ids)' }).transform(commaList);

const schema = z.object({
  /** Vercel Connect connector for the Slack app. */
  slackConnector: z.string().min(1).default('slack/till-dm'),
  /** Vercel Connect connector for the Airwallex MCP server. */
  airwallexConnector: z.string().min(1).default('airwallex/till-sandbox'),
  /** Login id for the shared, view-only team login. Any stable string works. */
  teamLoginId: z.string().min(1).default('finance-team'),
  /** Slack user ids who approve invoices and create them with their own Airwallex login. Each gets a card. */
  financeAdminSlackIds: slackUserIds.pipe(
    slackUserIdList
      .min(1, 'needs at least one Slack user id')
      .max(MAX_APPROVAL_CARDS, `at most ${MAX_APPROVAL_CARDS} admins (one approval card each)`),
  ),
  /** Slack user ids who may ask Till questions and request invoices. Admins are always included. */
  financeMemberSlackIds: slackUserIds.pipe(slackUserIdList).default([]),
  /** Vercel KMS issuer that signs Airwallex login links (Team Settings > Key Management). */
  kmsIssuerId: z.uuid({ error: 'required (a Vercel KMS issuer id)' }),
  /** How long a signed login link stays valid, in seconds. */
  loginLinkTtlSeconds: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  /** Model, through Vercel AI Gateway. */
  model: z.string().min(1).default('openai/gpt-5'),
  /** Lower effort answers faster; Till's tasks are short lookups. */
  modelReasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).default('low'),
  /** Company name used in Till's instructions. */
  companyName: z.string().min(1).default('the company'),
  /** How many recent messages in a DM Till reads for context. */
  historyLimit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Config = z.infer<typeof schema>;

/** The environment variable behind each setting. */
const ENV_NAMES: Record<keyof Config, string> = {
  slackConnector: 'TILL_SLACK_CONNECTOR',
  airwallexConnector: 'TILL_AIRWALLEX_CONNECTOR',
  teamLoginId: 'TILL_TEAM_LOGIN_ID',
  financeAdminSlackIds: 'TILL_FINANCE_ADMIN_SLACK_IDS',
  financeMemberSlackIds: 'TILL_FINANCE_MEMBER_SLACK_IDS',
  kmsIssuerId: 'TILL_KMS_ISSUER_ID',
  loginLinkTtlSeconds: 'TILL_LOGIN_LINK_TTL_SECONDS',
  model: 'TILL_MODEL',
  modelReasoningEffort: 'TILL_MODEL_REASONING_EFFORT',
  companyName: 'TILL_COMPANY_NAME',
  historyLimit: 'TILL_HISTORY_LIMIT',
};

/** Reads config from an environment object. Throws with every problem listed if anything is invalid. */
export function readConfig(env: Record<string, string | undefined>): Config {
  // An empty variable counts as unset, so its default applies.
  const raw = Object.fromEntries(Object.entries(ENV_NAMES).map(([key, name]) => [key, env[name] || undefined]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${ENV_NAMES[issue.path[0] as keyof Config] ?? issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid Till configuration: ${problems}`);
  }
  return parsed.data;
}

export const config: Config = readConfig(process.env);

export const isFinanceAdmin = (slackUserId: string): boolean => config.financeAdminSlackIds.includes(slackUserId);

/** Anyone Till talks to about finances: listed members and every admin. */
export const isFinanceMember = (slackUserId: string): boolean =>
  isFinanceAdmin(slackUserId) || config.financeMemberSlackIds.includes(slackUserId);
