// Whose Airwallex login does Till use? This file is the whole decision.
import { config } from '../config';

type Login = { type: 'user'; id: string };

// Questions: one shared team login, view-only, connected once by an admin.
export const forQuestions = (): Login => ({ type: 'user', id: config.teamLoginId });

// Anything that creates something: the person asking logs in as themselves.
export const forCreating = (slackUserId: string): Login => ({ type: 'user', id: slackUserId });

// Everyone shares one login:      forCreating = () => forQuestions()
// Everyone logs in as themselves: forQuestions = forCreating(<slack user id>)
