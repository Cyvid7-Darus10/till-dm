/** Every sentence Till shows people, in one place. Names and details from people pass through plainText. */
import { plainText, safeLink } from './slack/text';

const createdLink = (url: string): string => {
  const link = safeLink(url);
  return link ? ` <${link}|Open invoice>` : '';
};

export const COPY = {
  notOnTeam: 'I only work with the finance team. Ask a finance admin to add you.',
  dmOnly: 'I work in direct messages, so finance details stay private. Send me a DM.',
  noAccess: "I don't have access to our finances yet. A finance admin needs to connect Airwallex.",
  somethingWrong: 'Something went wrong on my side. Try again in a moment.',
  teamLoginLabel: 'team login',
  footer: (who: string) => `Airwallex: ${plainText(who)}`,
  /** To the requester, once the approval cards are out. `admins` is already Slack mention markup. */
  sentForApproval: (client: string, amount: string, admins: string) =>
    `I've asked ${admins} to approve an invoice for ${plainText(client)}, ${amount}. I'll message you here when it's decided.`,
  notCreated: (problem: string) => `I didn't create the invoice. ${plainText(problem)}`,
  tooLong: 'That request is too long for an approval card. Ask again with a shorter description.',
  notSent: "I couldn't send this request to every admin, so I cancelled it. Ask again in a moment.",
  cancelledNotSent: 'Cancelled: not every admin received this request.',
  approved: (adminName: string) => `Approved by ${plainText(adminName)}.`,
  declined: (adminName: string) => `Declined by ${plainText(adminName)}.`,
  /** To the requester. */
  requestDeclined: (adminName: string, client: string) => `${plainText(adminName)} declined your invoice request for ${plainText(client)}.`,
  requestApproved: (adminName: string, number: string, client: string, url: string) =>
    `${plainText(adminName)} approved your request. Created invoice ${plainText(number)} for ${plainText(client)}.${createdLink(url)}`,
  requestFailed: (adminName: string) =>
    `${plainText(adminName)} approved your request, but I didn't create the invoice. ${plainText(adminName)} has the details.`,
  /** To the admin who approved. */
  created: (number: string, client: string, url: string) =>
    `Created invoice ${plainText(number)} for ${plainText(client)}.${createdLink(url)}`,
  card: {
    title: (client: string) => `Invoice ${plainText(client)}`,
    lineItem: 'Line item',
    amount: 'Amount',
    terms: 'Terms',
    termsValue: (days: number) => `Net ${days}`,
    /** `requester` is Slack mention markup built from a validated user id. */
    requestedBy: (requester: string) => `Requested by ${requester}. Approving creates it with your own Airwallex login.`,
    approve: 'Approve',
    decline: 'Decline',
  },
  connect: {
    own: {
      title: 'Connect your Airwallex',
      body: "Approving creates the invoice with your own Airwallex login. Sign in once and I'll create it right after.",
    },
    team: {
      title: "Connect the team's Airwallex",
      body: 'One shared login, view only, so the finance team can ask me about balances and invoices.',
    },
  },
  page: {
    teamConnected: "The team's Airwallex is connected, view only. Go back to Slack and ask Till again.",
    creating: 'Airwallex is connected. Till is creating the invoice now. Go back to Slack to see it.',
    notConnectedYet: 'Airwallex is not connected yet. Try the button in Slack again.',
    invalidLink: 'That link is not valid or has expired. Press Approve in Slack again.',
    alreadyDecided: 'This request was already decided in Slack, so nothing was created.',
    failed: 'Something went wrong. Go back to Slack and try again.',
  },
} as const;
