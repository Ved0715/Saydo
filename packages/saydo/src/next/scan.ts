import fs from 'node:fs';
import path from 'node:path';

export interface ScannedRoute {
  pattern: string;
  /** Absolute path of the page file. */
  page: string;
  /** Absolute path of a colocated `nav.ts`, if any. */
  nav?: string;
}

export interface ScanResult {
  appDir: string | null;
  routes: ScannedRoute[];
  capabilityFiles: string[];
  warnings: string[];
}

const PAGE_RE = /^page\.(tsx|ts|jsx|js|mdx)$/;
const NAV_RE = /^nav\.(ts|tsx|js|mjs)$/;
const CODE_RE = /\.(ts|tsx|js|mjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.saydo']);

export function findAppDir(projectDir: string): string | null {
  for (const candidate of ['app', 'src/app']) {
    const dir = path.join(projectDir, candidate);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  return null;
}

/**
 * How a folder name contributes to the URL, following App Router conventions:
 * `(group)` is transparent, `_private`, `@slot` and intercepting `(.)x`
 * folders are not separate pages, everything else is one segment.
 */
function classify(name: string): 'segment' | 'group' | 'skip' {
  if (name.startsWith('_') || name.startsWith('@')) return 'skip';
  if (/^\(\.{1,3}\)/.test(name) || name.startsWith('(..)')) return 'skip';
  if (/^\(.+\)$/.test(name)) return 'group';
  return 'segment';
}

function walkRoutes(dir: string, segments: string[], routes: Map<string, ScannedRoute>, warnings: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const page = entries.find((e) => e.isFile() && PAGE_RE.test(e.name));
  const nav = entries.find((e) => e.isFile() && NAV_RE.test(e.name));
  if (page) {
    const pattern = `/${segments.join('/')}`;
    const existing = routes.get(pattern);
    if (existing) {
      warnings.push(`Two pages resolve to ${pattern}: ${existing.page} and ${path.join(dir, page.name)}.`);
    } else {
      routes.set(pattern, {
        pattern,
        page: path.join(dir, page.name),
        nav: nav ? path.join(dir, nav.name) : undefined,
      });
    }
  } else if (nav) {
    warnings.push(`${path.join(dir, nav.name)} has no page.tsx next to it, so it is ignored.`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const kind = classify(entry.name);
    if (kind === 'skip') continue;
    walkRoutes(path.join(dir, entry.name), kind === 'group' ? segments : [...segments, entry.name], routes, warnings);
  }
}

function walkFiles(dir: string, match: (file: string) => boolean, out: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkFiles(full, match, out);
    } else if (match(full)) out.push(full);
  }
}

function isServerActionFile(file: string): boolean {
  let head: string;
  try {
    head = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const body = head.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, '');
  return /^['"]use server['"]/.test(body) && /\bserverAction\s*\(/.test(head) && /from\s+['"]saydo(?:-js)?['"]/.test(head);
}

/** Scan an App Router project for pages, colocated nav metadata and capability modules. */
export function scanProject(projectDir: string, options: { capabilityDirs?: string[] } = {}): ScanResult {
  const warnings: string[] = [];
  const appDir = findAppDir(projectDir);
  const routes = new Map<string, ScannedRoute>();
  if (appDir) walkRoutes(appDir, [], routes, warnings);
  else warnings.push('No app/ or src/app/ directory found; navigation will be empty.');

  const capabilityFiles: string[] = [];
  for (const dir of options.capabilityDirs ?? ['capabilities', 'src/capabilities']) {
    walkFiles(path.join(projectDir, dir), (f) => CODE_RE.test(f) && !/\.(test|spec)\./.test(f) && !f.endsWith('.d.ts'), capabilityFiles);
  }
  if (appDir) walkFiles(appDir, (f) => /[/\\]capabilities\.(ts|tsx|js|mjs)$/.test(f), capabilityFiles);

  // 'use server' files that wrap actions with serverAction(): one function for UI and assistant.
  for (const dir of ['app', 'src', 'lib', 'actions', 'server']) {
    walkFiles(path.join(projectDir, dir), (f) => CODE_RE.test(f) && !f.endsWith('.d.ts') && isServerActionFile(f), capabilityFiles);
  }

  return {
    appDir,
    routes: [...routes.values()].sort((a, b) => a.pattern.localeCompare(b.pattern)),
    capabilityFiles: [...new Set(capabilityFiles)].sort(),
    warnings,
  };
}
