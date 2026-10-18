import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SaydoProvider } from 'saydo-js/next/client';
import { APP_NAME } from '@/lib/app-name';
import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'An AI-native Next.js app built with Saydo.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* One provider: every page becomes something users can ask about and act on. */}
        <SaydoProvider>
          <header className="topbar">
            <div className="topbar-inner">
              <a href="/" className="brand">
                <span className="brand-mark" aria-hidden="true" />
                {APP_NAME}
              </a>
              <a href="https://github.com/Ved0715/Saydo" className="ask">
                GitHub
              </a>
            </div>
          </header>
          <main>{children}</main>
        </SaydoProvider>
      </body>
    </html>
  );
}
