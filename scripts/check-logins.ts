// Shows which Airwallex logins Till can use right now, and how many tools each one sees.
// Never prints tokens. Usage: npm run check-logins -- [slack user id...]
import { forCreating, forQuestions } from '../lib/airwallex/logins';
import { isConnected, openAirwallex } from '../lib/airwallex/session';
import { SCOPES } from '../lib/airwallex/tool-policy';
import { config } from '../lib/config';

async function report(label: string, login: ReturnType<typeof forQuestions>, scopes: readonly string[], access: 'view' | 'create') {
  if (!(await isConnected(login, scopes))) {
    console.info(`--  ${label}: not connected`);
    return;
  }
  const airwallex = await openAirwallex(login, scopes, access);
  try {
    console.info(`OK  ${label}: connected, ${Object.keys(airwallex.tools).length} tools (${access})`);
  } finally {
    await airwallex.close();
  }
}

const adminIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : config.financeAdminSlackIds;
await report(`team login (${config.teamLoginId})`, forQuestions(), SCOPES.questions, 'view');
for (const id of adminIds) await report(`admin ${id}`, forCreating(id), SCOPES.creating, 'create');
