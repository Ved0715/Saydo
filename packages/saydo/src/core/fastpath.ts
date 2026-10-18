/**
 * Deterministic route search. Powers the ⌘K palette and the fast path that
 * answers "take me to billing" without an LLM round trip.
 */

export interface NavTarget {
  pattern: string;
  title: string;
  aliases?: string[];
}

const NAV_PREFIX =
  /^(please\s+)?(go to|goto|open( up)?|take me to|navigate to|show me|show|bring me to|jump to|switch to|visit)\s+/;
const FILLER = new Set(['the', 'my', 'page', 'screen', 'section', 'please', 'a', 'an']);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, ' ')
    .split(/[\s/]+/)
    .filter((t) => t && !FILLER.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));

const stripPrefix = (query: string) => query.trim().toLowerCase().replace(NAV_PREFIX, '');

/** Title and aliases can match exactly (score 1); the URL segment only nearly (0.9). */
function candidatesFor(route: NavTarget): Array<{ tokens: string[]; exact: number }> {
  const lastStatic = route.pattern
    .split('/')
    .filter((s) => s && !s.startsWith('['))
    .pop();
  return [
    ...[route.title, ...(route.aliases ?? [])].map((text) => ({ tokens: tokenize(text), exact: 1 })),
    ...(lastStatic ? [{ tokens: tokenize(lastStatic), exact: 0.9 }] : []),
  ];
}

export function scoreRoute(query: string, route: NavTarget): number {
  const q = tokenize(stripPrefix(query));
  if (!q.length) return 0;
  const qs = q.join(' ');
  let best = 0;
  for (const { tokens, exact } of candidatesFor(route)) {
    if (!tokens.length) continue;
    const candidate = tokens.join(' ');
    if (candidate === qs) best = Math.max(best, exact);
    if (qs.length >= 3 && candidate.startsWith(qs)) best = Math.max(best, 0.85);
    const overlap = q.filter((t) => tokens.includes(t)).length;
    best = Math.max(best, (overlap / Math.max(q.length, tokens.length)) * 0.8);
  }
  return best;
}

export function searchRoutes<T extends NavTarget>(query: string, routes: T[], limit = 8): Array<{ route: T; score: number }> {
  return routes
    .map((route) => ({ route, score: scoreRoute(query, route) }))
    .filter((r) => r.score > 0.2)
    .sort((a, b) => b.score - a.score || a.route.pattern.length - b.route.pattern.length)
    .slice(0, limit);
}

/**
 * Return a route only when the query is unambiguously navigational: an exact
 * title/alias match, unique, and either phrased as navigation or just the name.
 */
export function fastPath<T extends NavTarget>(query: string, routes: T[]): T | null {
  const lower = query.trim().toLowerCase();
  if (!lower || tokenize(lower).length > 6) return null;
  const [top, second] = searchRoutes(query, routes, 2);
  if (!top || top.score < 1) return null;
  if (second && second.score >= 1) return null;
  const phrasedAsNav = NAV_PREFIX.test(lower);
  const justTheName = tokenize(lower).length === tokenize(stripPrefix(lower)).length;
  return phrasedAsNav || justTheName ? top.route : null;
}
