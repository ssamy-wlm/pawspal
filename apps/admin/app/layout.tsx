import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import tokens from '../src/tokens.json';
import { AuthProvider } from '../src/auth';
import { Shell } from '../src/shell';

export const metadata: Metadata = {
  title: 'PawsPal Admin',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: tokens.color.dark.background,
          color: tokens.color.dark.text,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <AuthProvider>
          <Shell>{children}</Shell>
        </AuthProvider>
      </body>
    </html>
  );
}
