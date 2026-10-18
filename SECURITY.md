# Security

## Reporting a problem

Report security problems privately through GitHub: open the repository's Security tab and choose
"Report a vulnerability". Please don't open a public issue for them.

Include what you found, how to reproduce it, and what an attacker could do with it.

## What Till is designed to prevent

- Anyone outside the finance member and admin lists reading finance data.
- Anyone who is not a finance admin approving or creating anything in Airwallex.
- An approval button being reused on another message, or an approval link being forged.
- The model calling tools that move money, whatever a message or an Airwallex record says.
- An invoice going out for a different client or amount than the one on the approval card.
- Two invoices for one request, from a double click or two admins approving at once.
- Names or model output that ping people or disguise a link in Slack.

## What it does not prevent

Every finance member can read everything the shared team login can see. Slack keeps DMs, and workspace
owners on some plans can export them. The README section "Privacy" explains how to limit that.
