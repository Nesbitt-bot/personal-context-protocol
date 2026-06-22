import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Personal Context Protocol',
  description: 'Scoped AI session recording with human control',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
        {children}
      </body>
    </html>
  );
}
