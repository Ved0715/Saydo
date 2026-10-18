import type { z } from 'zod';
import type { EntityParam } from './entity';
import type { SaydoUser, Exposure } from './types';

const ROUTE_BRAND = Symbol.for('saydo.route');

/** Optional per-route metadata, colocated as `app/<segment>/nav.ts`. */
export interface RouteDefinition {
  title?: string;
  aliases?: string[];
  describe?: string;
  /** Bind dynamic segments to entities so the model can fill them with handles. */
  params?: Record<string, EntityParam<any>>;
  /** URL state (filters, tabs, sort) the assistant may set. Values must be strings. */
  search?: z.ZodObject;
  /** Server-side visibility check. Hidden routes are never sent to the model or palette. */
  access?: (user: SaydoUser) => boolean | Promise<boolean>;
  hidden?: boolean;
  expose?: Exposure;
}

export type Route = RouteDefinition & { readonly [ROUTE_BRAND]: true };

export function defineRoute(definition: RouteDefinition): Route {
  return { ...definition, [ROUTE_BRAND]: true };
}

export interface RouteDeclaration extends RouteDefinition {
  /** React Router style path: '/posts/:id', '/docs/*'. */
  path: string;
}

/** Convert a React Router path to the bracket pattern used internally ('/posts/:id' → '/posts/[id]'). */
export function toPattern(routePath: string): string {
  const parts = routePath.split('/').filter(Boolean).map((part) => {
    if (part === '*') return '[...splat]';
    if (part.endsWith('?')) {
      throw new Error(`Optional segment "${part}" in "${routePath}" is not supported (fix: declare the route with and without it).`);
    }
    return part.startsWith(':') ? `[${part.slice(1)}]` : part;
  });
  return `/${parts.join('/')}`;
}

/**
 * For apps without a file-system router (Vite + React Router): declare the
 * pages the assistant may open, once, in `saydo.routes.ts`.
 */
export function defineRoutes(routes: RouteDeclaration[]): RouteRecord[] {
  return routes.map(({ path, ...nav }) => ({ pattern: toPattern(path), nav: defineRoute(nav) }));
}

/** One page in the app, as produced by the route scanner. */
export interface RouteRecord {
  pattern: string;
  nav?: RouteDefinition;
}

export type Segment =
  | { kind: 'static'; value: string }
  | { kind: 'dynamic'; name: string }
  | { kind: 'catchall'; name: string; optional: boolean };

export function parsePattern(pattern: string): Segment[] {
  return pattern
    .split('/')
    .filter(Boolean)
    .map((part): Segment => {
      const optionalCatchall = /^\[\[\.\.\.(.+)\]\]$/.exec(part);
      if (optionalCatchall) return { kind: 'catchall', name: optionalCatchall[1]!, optional: true };
      const catchall = /^\[\.\.\.(.+)\]$/.exec(part);
      if (catchall) return { kind: 'catchall', name: catchall[1]!, optional: false };
      const dynamic = /^\[(.+)\]$/.exec(part);
      if (dynamic) return { kind: 'dynamic', name: dynamic[1]! };
      return { kind: 'static', value: part };
    });
}

export function paramNames(pattern: string): string[] {
  return parsePattern(pattern).flatMap((s) => (s.kind === 'static' ? [] : [s.name]));
}

export function isStaticPattern(pattern: string): boolean {
  return parsePattern(pattern).every((s) => s.kind === 'static');
}

/** Build a concrete path. Throws (with a fix) when a required param is missing. */
export function buildPath(pattern: string, params: Record<string, string | string[]> = {}): string {
  const parts: string[] = [];
  for (const segment of parsePattern(pattern)) {
    if (segment.kind === 'static') parts.push(segment.value);
    else if (segment.kind === 'dynamic') {
      const value = params[segment.name];
      if (typeof value !== 'string' || value === '') {
        throw new Error(`Missing route param "${segment.name}" for ${pattern} (fix: pass params.${segment.name}).`);
      }
      parts.push(encodeURIComponent(value));
    } else {
      const raw = params[segment.name];
      const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
      if (!values.length && !segment.optional) {
        throw new Error(`Missing route param "${segment.name}" for ${pattern} (fix: pass params.${segment.name}).`);
      }
      parts.push(...values.map((v) => encodeURIComponent(v)));
    }
  }
  return `/${parts.join('/')}`;
}

/** Match a concrete pathname against a pattern, returning decoded params. */
export function matchPath(pattern: string, pathname: string): Record<string, string | string[]> | null {
  const segments = parsePattern(pattern);
  const parts = pathname.split('?')[0]!.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const params: Record<string, string | string[]> = {};
  let i = 0;
  for (const segment of segments) {
    if (segment.kind === 'static') {
      if (parts[i] !== segment.value) return null;
      i++;
    } else if (segment.kind === 'dynamic') {
      const part = parts[i];
      if (part === undefined) return null;
      params[segment.name] = part;
      i++;
    } else {
      const rest = parts.slice(i);
      if (!rest.length && !segment.optional) return null;
      params[segment.name] = rest;
      i = parts.length;
    }
  }
  return i === parts.length ? params : null;
}

/** Most specific match wins: static segments beat dynamic, dynamic beats catch-all. */
export function findRoute<T extends { pattern: string }>(routes: T[], pathname: string): T | undefined {
  const score = (pattern: string) =>
    parsePattern(pattern).reduce(
      (acc, s) => acc + (s.kind === 'static' ? 100 : s.kind === 'dynamic' ? 10 : 1),
      0,
    );
  return routes
    .filter((r) => matchPath(r.pattern, pathname))
    .sort((a, b) => score(b.pattern) - score(a.pattern))[0];
}

const words = (s: string) =>
  s
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();

/** '/' → 'Home', '/billing' → 'Billing', '/posts/new' → 'Posts / New', '/posts/[id]' → 'Posts / Item'. */
export function titleFromPattern(pattern: string): string {
  const segments = parsePattern(pattern);
  if (!segments.length) return 'Home';
  return segments
    .map((s) => (s.kind === 'static' ? words(s.value) : s.kind === 'dynamic' ? 'item' : 'pages'))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' / ');
}
