'use client';
import { z } from 'zod';
import { useAction } from 'saydo-js/next/client';

const sections = z.object({ section: z.enum(['playground', 'guide', 'features', 'top']) });

/** Lets the assistant scroll the landing page: "show me the guide". */
export function SiteActions() {
  useAction(
    'site.show',
    'Scroll the landing page to a section: the playground, the getting-started guide, the features, or the top',
    ({ section }) => {
      const target = document.getElementById(section);
      target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      (target?.querySelector('h2, h1') as HTMLElement | null)?.focus({ preventScroll: true });
      return { status: 'ok', message: `Showing the ${section}.` };
    },
    { input: sections },
  );
  return null;
}
