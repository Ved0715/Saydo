import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SaydoProvider } from 'saydo/next/client';
import './globals.css';

export const metadata: Metadata = {
  title: 'Acme Posts · saydo demo',
  description: 'Every page is navigable by the assistant; actions are declared and gated.',
};

// Day 1, step 2 of 3: one provider in the root layout.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SaydoProvider>
          <header className="topbar">
            <Link href="/" className="brand">
              Acme Posts
            </Link>
            <nav aria-label="Main">
              <Link href="/posts">Posts</Link>
              <Link href="/billing">Billing</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </header>
          <main>{children}</main>
        </SaydoProvider>
      </body>
    </html>
  );
}
