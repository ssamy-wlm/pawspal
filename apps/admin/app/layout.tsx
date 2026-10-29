import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import tokens from '../src/tokens.json';

export const metadata: Metadata = {
  title: 'PawsPal Admin',
  robots: { index: false, follow: false },
};

const navy = tokens.color.dark;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: navy.background,
          color: navy.text,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
