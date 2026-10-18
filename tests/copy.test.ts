import { describe, expect, it } from 'vitest';
import { COPY } from '../lib/copy';

describe("Till's messages", () => {
  it('tell the requester who was asked and what for', () => {
    expect(COPY.sentForApproval('Parkside Dental Group', 'USD 3,950.00', '<@UADMIN0001>')).toBe(
      "I've asked <@UADMIN0001> to approve an invoice for Parkside Dental Group, USD 3,950.00. I'll message you here when it's decided.",
    );
  });

  it('link the invoice only when Airwallex returned a link', () => {
    expect(COPY.created('INV-1', 'Parkside', 'https://example.com/i')).toContain('<https://example.com/i|Open invoice>');
    expect(COPY.created('INV-1', 'Parkside', '')).toBe('Created invoice INV-1 for Parkside.');
  });

  it('tell the requester the outcome and who decided', () => {
    expect(COPY.requestApproved('Alex', 'INV-1', 'Parkside', '')).toBe('Alex approved your request. Created invoice INV-1 for Parkside.');
    expect(COPY.requestDeclined('Alex', 'Parkside')).toBe('Alex declined your invoice request for Parkside.');
    expect(COPY.requestFailed('Alex')).toBe("Alex approved your request, but I didn't create the invoice. Alex has the details.");
  });

  it('keep names from acting as Slack markup', () => {
    expect(COPY.requestDeclined('<!channel>', 'Parkside')).not.toContain('<!channel>');
  });

  it('fill in names, terms and the footer', () => {
    expect(COPY.card.requestedBy('<@UMEMBER001>')).toBe('Requested by <@UMEMBER001>. Approving creates it with your own Airwallex login.');
    expect(COPY.approved('Alex')).toBe('Approved by Alex.');
    expect(COPY.declined('Alex')).toBe('Declined by Alex.');
    expect(COPY.notCreated('No such client.')).toBe("I didn't create the invoice. No such client.");
    expect(COPY.card.title('Parkside')).toBe('Invoice Parkside');
    expect(COPY.card.termsValue(14)).toBe('Net 14');
    expect(COPY.footer('team login')).toBe('Airwallex: team login');
  });
});
