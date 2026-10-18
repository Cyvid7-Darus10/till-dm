import type { ReactNode } from 'react';

export const metadata = { title: 'Till', description: 'A finance agent in Slack, backed by Airwallex.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ font: '16px system-ui', background: '#F7F5EF', color: '#0F5132', margin: 0 }}>{children}</body>
    </html>
  );
}
