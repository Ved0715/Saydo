import type { Capability } from './capability';
import type { RouteRecord } from './route';
import { parsePattern } from './route';
import type { Risk } from './types';

/**
 * `saydo.capabilities.json`: the committed record of what the assistant may
 * do and how risky each action is. Dev updates it; CI builds refuse to ship
 * when it is stale. Any lowered risk or widened exposure therefore shows up
 * as a diff in code review instead of slipping in silently.
 */
export interface LockEntry {
  risk: Risk;
  kind: 'server' | 'client';
  version: number;
  expose: string[];
}

export interface Lockfile {
  lockfileVersion: 1;
  capabilities: Record<string, LockEntry>;
  routes: string[];
  /** External tool sources (MCP servers, OpenAPI specs, tRPC routers). */
  sources?: string[];
}

export const LOCKFILE_NAME = 'saydo.capabilities.json';

const RISK_RANK: Record<Risk, number> = { read: 0, reversible: 1, write: 2, destructive: 3, never: 4 };

function exposureOf(cap: Capability): string[] {
  const expose = { assistant: true, browserAgent: false, external: false, ...cap.expose };
  return Object.entries(expose)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .sort();
}

export function buildLock(capabilities: Capability[], routes: RouteRecord[], sources: string[] = []): Lockfile {
  const entries = [...capabilities]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((cap) => [cap.id, { risk: cap.resolvedRisk, kind: cap.kind, version: cap.version ?? 1, expose: exposureOf(cap) }] as const);
  const offered = routes
    .filter((r) => !r.nav?.hidden && r.nav?.expose?.assistant !== false)
    .filter((r) =>
      parsePattern(r.pattern).every((s) => s.kind === 'static' || (s.kind === 'dynamic' && r.nav?.params?.[s.name])),
    )
    .map((r) => (r.nav?.access ? `${r.pattern} (restricted)` : r.pattern))
    .sort();
  const lock: Lockfile = { lockfileVersion: 1, capabilities: Object.fromEntries(entries), routes: offered };
  if (sources.length) lock.sources = [...sources].sort();
  return lock;
}

/** One line per capability and route, so a lowered risk is a one-line diff in review. */
export function serializeLock(lock: Lockfile): string {
  const caps = Object.entries(lock.capabilities).map(([id, entry]) => `    ${JSON.stringify(id)}: ${JSON.stringify(entry)}`);
  const routes = lock.routes.map((r) => `    ${JSON.stringify(r)}`);
  const sources = (lock.sources ?? []).map((r) => `    ${JSON.stringify(r)}`);
  return [
    '{',
    '  "lockfileVersion": 1,',
    `  "capabilities": {${caps.length ? `\n${caps.join(',\n')}\n  ` : ''}},`,
    `  "routes": [${routes.length ? `\n${routes.join(',\n')}\n  ` : ''}]${sources.length ? ',' : ''}`,
    ...(sources.length ? [`  "sources": [\n${sources.join(',\n')}\n  ]`] : []),
    '}',
    '',
  ].join('\n');
}

export function parseLock(text: string | undefined | null): Lockfile | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Lockfile;
    return value && value.lockfileVersion === 1 && typeof value.capabilities === 'object' ? value : null;
  } catch {
    return null;
  }
}

export interface LockDiff {
  changed: boolean;
  /** Lowered risk or widened exposure: must be reviewed. */
  needsReview: boolean;
  added: string[];
  removed: string[];
  riskLowered: Array<{ id: string; from: Risk; to: Risk }>;
  riskRaised: Array<{ id: string; from: Risk; to: Risk }>;
  exposureWidened: Array<{ id: string; added: string[] }>;
  routesAdded: string[];
  routesRemoved: string[];
  sourcesAdded: string[];
}

export function diffLock(previous: Lockfile | null, next: Lockfile): LockDiff {
  const before = previous?.capabilities ?? {};
  const diff: LockDiff = {
    changed: false,
    needsReview: false,
    added: [],
    removed: [],
    riskLowered: [],
    riskRaised: [],
    exposureWidened: [],
    routesAdded: [],
    routesRemoved: [],
    sourcesAdded: [],
  };
  for (const [id, entry] of Object.entries(next.capabilities)) {
    const old = before[id];
    if (!old) {
      diff.added.push(id);
      // A brand-new capability below 'destructive' was explicitly downgraded from the default.
      if (RISK_RANK[entry.risk] < RISK_RANK.destructive || entry.expose.some((e) => e !== 'assistant')) {
        diff.needsReview = true;
      }
      continue;
    }
    if (RISK_RANK[entry.risk] < RISK_RANK[old.risk]) diff.riskLowered.push({ id, from: old.risk, to: entry.risk });
    if (RISK_RANK[entry.risk] > RISK_RANK[old.risk]) diff.riskRaised.push({ id, from: old.risk, to: entry.risk });
    const widened = entry.expose.filter((e) => !old.expose.includes(e));
    if (widened.length) diff.exposureWidened.push({ id, added: widened });
  }
  diff.removed = Object.keys(before).filter((id) => !(id in next.capabilities));
  const oldRoutes = new Set(previous?.routes ?? []);
  const newRoutes = new Set(next.routes);
  diff.routesAdded = next.routes.filter((r) => !oldRoutes.has(r));
  diff.routesRemoved = [...oldRoutes].filter((r) => !newRoutes.has(r));
  const oldSources = new Set(previous?.sources ?? []);
  diff.sourcesAdded = (next.sources ?? []).filter((s) => !oldSources.has(s));
  diff.changed = !previous || serializeLock(previous) !== serializeLock(next);
  diff.needsReview ||= diff.riskLowered.length > 0 || diff.exposureWidened.length > 0 || diff.sourcesAdded.length > 0;
  return diff;
}

export function formatLockDiff(diff: LockDiff): string {
  const lines: string[] = [];
  for (const id of diff.added) lines.push(`  + ${id}`);
  for (const id of diff.removed) lines.push(`  - ${id}`);
  for (const r of diff.riskLowered) lines.push(`  ! ${r.id}: risk lowered ${r.from} → ${r.to}`);
  for (const r of diff.riskRaised) lines.push(`    ${r.id}: risk raised ${r.from} → ${r.to}`);
  for (const e of diff.exposureWidened) lines.push(`  ! ${e.id}: now exposed to ${e.added.join(', ')}`);
  for (const r of diff.routesAdded) lines.push(`  + route ${r}`);
  for (const r of diff.routesRemoved) lines.push(`  - route ${r}`);
  for (const s of diff.sourcesAdded) lines.push(`  ! new tool source ${s}`);
  return lines.join('\n');
}
