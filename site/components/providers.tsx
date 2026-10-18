'use client';
import type { ReactNode } from 'react';
import { SaydoProvider } from 'saydo-js/next/client';
import { modelHeaders } from '@/lib/model-key';
import { SiteActions } from './site-actions';

// The site runs on Saydo: ⌘K works everywhere, with the model the visitor picked in the playground.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SaydoProvider headers={modelHeaders} placeholder="Ask this site anything, or jump to a section…">
      <SiteActions />
      {children}
    </SaydoProvider>
  );
}
