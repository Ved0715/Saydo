import type { Risk } from './types';

/** One answerable piece of "how do I…": developer docs or generated from the app's own declarations. */
export interface GuideEntry {
  title: string;
  text: string;
  /** Pages it applies to; entries for the current page rank first. */
  routes?: string[];
  keywords?: string[];
  source: 'docs' | 'page' | 'action';
}

export function consentSentence(risk: Risk): string {
  switch (risk) {
    case 'read':
      return 'The assistant can do this right away.';
    case 'reversible':
      return 'The assistant can do this right away, and it can be undone.';
    case 'write':
      return 'The assistant can do this; it asks you to confirm first.';
    case 'destructive':
      return 'The assistant can do this; it shows the full details and asks you to confirm. Large changes need extra confirmation.';
    case 'never':
      return 'Only you can do this, on the page itself.';
  }
}

const STOP = new Set(['how', 'do', 'i', 'can', 'the', 'a', 'an', 'to', 'my', 'is', 'it', 'where', 'what', 'in', 'on', 'of', 'for', 'me', 'you', 'this', 'that', 'with', 'and', 'or']);

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));

/** Keyword ranking with a boost for entries about the current page and for written docs. */
export function rankGuide(question: string, entries: GuideEntry[], route: string, limit = 6): GuideEntry[] {
  const q = new Set(words(question));
  const pathname = route.split('?')[0] || '/';
  const onPage = (entry: GuideEntry) => (entry.routes ?? []).some((pattern) => pattern === pathname || (pattern.endsWith('/*') && pathname.startsWith(pattern.slice(0, -2))));
  return entries
    .map((entry) => {
      const hay = new Set(words(`${entry.title} ${entry.text} ${(entry.keywords ?? []).join(' ')}`));
      const titleHits = words(entry.title).filter((w) => q.has(w)).length;
      const hits = [...q].filter((w) => hay.has(w)).length;
      const score = hits + titleHits * 0.5 + (onPage(entry) ? 0.75 : 0) + (entry.source === 'docs' && hits ? 0.5 : 0);
      return { entry, score };
    })
    .filter((r) => r.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.entry);
}

/** `admin.*` and `admin/*` style patterns, or exact ids and paths. */
export function matchesAny(value: string, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return false;
  return patterns.some((pattern) => {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1).replace(/[./]$/, '');
      return value === prefix || value.startsWith(`${prefix}.`) || value.startsWith(`${prefix}/`);
    }
    return value === pattern;
  });
}
