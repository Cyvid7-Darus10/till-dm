import type { ApprovedInvoice, PendingInvoice } from '../lib/invoices/request';

/** Sam (a finance member) asked in a DM; Alex and Jo (admins) each got an approval card. */
export const pending: PendingInvoice = {
  request: {
    customer: 'Parkside Dental',
    description: 'Website redesign',
    amount: 3950,
    currency: 'USD',
    daysUntilDue: 30,
  },
  client: { id: 'cus_123', name: 'Parkside Dental Group' },
  requestId: 'till-1792068287.429589',
  requester: { id: 'UMEMBER001', name: 'Sam Ortiz', threadId: 'slack:D0SAM00001:' },
  cards: [
    { channel: 'D0ALEX0001', messageId: '1792068290.000100' },
    { channel: 'D0JO000001', messageId: '1792068290.000200' },
  ],
};

export const approved: ApprovedInvoice = { pending, approver: { id: 'UADMIN0001', name: 'Alex Morgan' } };
