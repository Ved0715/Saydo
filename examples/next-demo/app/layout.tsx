import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SaydoProvider } from 'saydo-js/next/client';
import { AskButton } from '@/components/ask-button';
import { APP_NAME } from '@/lib/app-name';
import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'An AI-native Next.js app built with Saydo. Press ⌘K and ask.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

// Day 1, step 2 of 3: one provider in the root layout.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SaydoProvider>
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                <span className="brand-mark" aria-hidden="true" />
                {APP_NAME}
              </Link>
              <nav aria-label="Main">
                <Link href="/posts">Posts</Link>
                <Link href="/billing">Billing</Link>
                <Link href="/settings">Settings</Link>
              </nav>
              <AskButton />
            </div>
          </header>
          <main>{children}</main>
          <footer className="footer">
            <div className="footer-inner">
              <span>
                Built with <a href="https://github.com/Ved0715/Saydo#readme">Saydo</a>
              </span>
              <span>
                Edit <code>app/page.tsx</code> to make this page yours
              </span>
            </div>
          </footer>
        </SaydoProvider>
      </body>
    </html>
  );
}
