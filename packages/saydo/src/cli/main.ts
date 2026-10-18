import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseLock, LOCKFILE_NAME } from '../core/lockfile';
import { findAppDir, scanProject } from '../next/scan';
import { addProviderToLayout, addVitePlugin, configFile, ROUTE_FILE, VITE_ROUTES_FILE, wrapNextConfig } from './codemods';

const VERSION = '0.1.0';
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = paint(1);
const dim = paint(2);
const green = paint(32);
const yellow = paint(33);
const red = paint(31);
const cyan = paint(36);

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | true>;
}

function parse(argv: string[]): Args {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      const next = argv[i + 1];
      if (value !== undefined) flags[key!] = value;
      else if (next && !next.startsWith('-') && ['url', 'dir', 'route'].includes(key!)) flags[key!] = argv[++i]!;
      else flags[key!] = true;
    } else if (arg === '-h') flags.help = true;
    else if (arg === '-v') flags.version = true;
    else positional.push(arg);
  }
  return { command: positional.shift() ?? 'help', positional, flags };
}

function readJson(file: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function firstExisting(dir: string, names: string[]): string | undefined {
  return names.map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
}

type Framework = 'next' | 'vite' | 'unknown';

function detect(dir: string): { framework: Framework; pkg: Record<string, any> | null } {
  const pkg = readJson(path.join(dir, 'package.json'));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (deps.next) return { framework: 'next', pkg };
  if (deps.vite && deps.react) return { framework: 'vite', pkg };
  return { framework: 'unknown', pkg };
}

function packageManager(dir: string): { name: string; add: string[] } {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return { name: 'pnpm', add: ['pnpm', 'add'] };
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return { name: 'yarn', add: ['yarn', 'add'] };
  if (fs.existsSync(path.join(dir, 'bun.lock')) || fs.existsSync(path.join(dir, 'bun.lockb'))) return { name: 'bun', add: ['bun', 'add'] };
  return { name: 'npm', add: ['npm', 'install'] };
}

function write(file: string, content: string, changes: string[], label: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  changes.push(`${green('✓')} ${label} ${dim(path.basename(file))}`);
}

// ---------------------------------------------------------------- init

function init(dir: string, flags: Args['flags']): number {
  const { framework, pkg } = detect(dir);
  if (!pkg) {
    console.error(red(`No package.json in ${dir}.`), `Run this inside your app, or create one with ${cyan('npx create-saydo-app')}.`);
    return 1;
  }
  const changes: string[] = [];
  const manual: string[] = [];
  const appName = String(pkg.name ?? path.basename(dir));

  if (framework === 'next') {
    const appDir = findAppDir(dir);
    if (!appDir) {
      console.error(red('Saydo needs the App Router (app/ or src/app/).'), 'Pages Router support is planned.');
      return 1;
    }
    const nextConfig = firstExisting(dir, ['next.config.ts', 'next.config.mjs', 'next.config.mts', 'next.config.js']);
    if (!nextConfig) {
      write(path.join(dir, 'next.config.ts'), "import { withSaydo } from 'saydo-js/next';\n\nexport default withSaydo({});\n", changes, 'created');
    } else {
      const next = wrapNextConfig(fs.readFileSync(nextConfig, 'utf8'));
      if (next) write(nextConfig, next, changes, 'wrapped with withSaydo()');
      else manual.push(`Wrap your Next config: ${cyan("export default withSaydo(nextConfig)")} (import from 'saydo-js/next'). CommonJS configs: rename to next.config.mjs first.`);
    }
    const layout = firstExisting(appDir, ['layout.tsx', 'layout.jsx', 'layout.js']);
    const updated = layout ? addProviderToLayout(fs.readFileSync(layout, 'utf8')) : null;
    if (layout && updated) write(layout, updated, changes, 'added <SaydoProvider> to');
    else manual.push(`In your root layout, wrap ${cyan('{children}')} with ${cyan('<SaydoProvider>')} from 'saydo-js/next/client'.`);
    const route = path.join(appDir, 'api', 'saydo', 'route.ts');
    if (!fs.existsSync(route)) write(route, ROUTE_FILE, changes, 'created');
  } else if (framework === 'vite') {
    const viteConfig = firstExisting(dir, ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']);
    const updated = viteConfig ? addVitePlugin(fs.readFileSync(viteConfig, 'utf8')) : null;
    if (viteConfig && updated) write(viteConfig, updated, changes, 'added saydo() to');
    else manual.push(`Add ${cyan('saydo()')} from 'saydo-js/vite' to your Vite plugins.`);
    if (!firstExisting(dir, ['saydo.routes.ts', 'src/saydo.routes.ts'])) write(path.join(dir, 'saydo.routes.ts'), VITE_ROUTES_FILE, changes, 'created');
    manual.push(
      `Render ${cyan('<SaydoProvider>')} from 'saydo-js/react-router' inside your router (e.g. around <Outlet /> in the root layout route).`,
      `List your pages in ${cyan('saydo.routes.ts')}.`,
    );
  } else {
    console.error(red('Could not detect Next.js or Vite + React in package.json.'));
    return 1;
  }

  if (!firstExisting(dir, ['saydo.config.ts', 'saydo.config.mts', 'saydo.config.js', 'saydo.config.mjs'])) {
    write(path.join(dir, 'saydo.config.ts'), configFile(appName), changes, 'created');
  }
  const gitignore = path.join(dir, '.gitignore');
  const ignored = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  if (!ignored.split('\n').some((l) => l.trim() === '.saydo')) {
    fs.writeFileSync(gitignore, `${ignored}${ignored && !ignored.endsWith('\n') ? '\n' : ''}.saydo\n`);
    changes.push(`${green('✓')} ignored ${dim('.saydo')} in .gitignore`);
  }

  const deps = ['saydo-js', 'ai', 'zod'].filter((d) => !pkg.dependencies?.[d] && !pkg.devDependencies?.[d]);
  const pm = packageManager(dir);
  console.log(`\n${bold('Saydo')} ${dim(`· ${framework === 'next' ? 'Next.js' : 'Vite + React'}`)}\n`);
  for (const line of changes) console.log(`  ${line}`);
  if (deps.length) {
    if (flags.install) {
      console.log(`\n  ${dim('$')} ${pm.add.join(' ')} ${deps.join(' ')}`);
      const result = spawnSync(pm.add[0]!, [...pm.add.slice(1), ...deps], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
      if (result.status !== 0) return result.status ?? 1;
    } else {
      manual.unshift(`Install: ${cyan(`${pm.add.join(' ')} ${deps.join(' ')}`)}  ${dim('(and a model provider, e.g. @ai-sdk/anthropic)')}`);
    }
  }
  if (manual.length) {
    console.log(`\n${bold('Next steps')}`);
    manual.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
  }
  console.log(`\nStart your dev server and press ${bold('⌘K')} (Ctrl K). Every page is already navigable.`);
  console.log(dim(`Add actions in capabilities/, wrap Server Actions with serverAction(), or just let the assistant use the page.\n`));
  return 0;
}

// ---------------------------------------------------------------- dev-server commands

async function call(url: string, body: unknown): Promise<any> {
  const endpoint = new URL('/api/saydo', url);
  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', origin: endpoint.origin }, body: JSON.stringify(body) });
  } catch {
    throw new Error(`Could not reach ${endpoint} (fix: start your dev server, or pass --url).`);
  }
  return response.json();
}

function clientFor(route: string) {
  return { route, tabId: 'saydo-cli', mounted: [], uiActions: [] };
}

async function ask(text: string, flags: Args['flags']): Promise<number> {
  if (!text) {
    console.error(`Usage: ${cyan('saydo ask "take me to billing" [--route /posts/1] [--url http://localhost:3000]')}`);
    return 1;
  }
  const url = String(flags.url ?? 'http://localhost:3000');
  const route = String(flags.route ?? '/');
  const result = await call(url, { type: 'message', text, client: clientFor(route) });
  if (!result.ok) {
    console.error(red(result.message ?? 'Request failed.'), result.fix ? dim(result.fix) : '');
    return 1;
  }
  console.log(`\n${dim('you')}  ${text}  ${dim(`(on ${route})`)}`);
  for (const event of result.events) {
    if (event.type === 'assistant') console.log(`${cyan('ai')}   ${event.text}`);
    else console.log(`${dim('     ' + (event.status === 'ok' ? green('✓') : yellow('•')) + ' ' + (event.message ?? event.title))}`);
  }
  for (const effect of result.effects) if (effect.type === 'navigate') console.log(dim(`     → would open ${effect.href}`));
  if (result.pending?.type === 'confirm') {
    const view = result.pending.view;
    console.log(`\n  ${view.danger ? red('▲') : yellow('?')} ${bold(view.title)}  ${dim(`(tier ${result.pending.tier}: the user must approve in the app)`)}`);
    for (const field of view.fields) console.log(`    ${dim(field.label + ':')} ${field.value}`);
  } else if (result.pending?.type === 'dispatch') {
    console.log(dim(`     → would run ${result.pending.kind} "${result.pending.target}" in the browser`));
  }
  console.log('');
  return 0;
}

async function inspect(route: string, flags: Args['flags']): Promise<number> {
  const url = String(flags.url ?? 'http://localhost:3000');
  const result = await call(url, { type: 'inspect', client: clientFor(route) });
  if (!result.ok) {
    console.error(red(result.message ?? 'Inspect failed.'), dim(result.fix ?? ''));
    return 1;
  }
  const estimate = result.estimate
    ? `, ~${result.estimate.inputTokens} input tokens per step${result.estimate.costUsd !== undefined ? `, ~$${result.estimate.costUsd.toFixed(4)}` : ''}`
    : '';
  console.log(`\n${bold(`What the model gets on ${route}`)}  ${dim(`(${result.tools.length} tools${estimate})`)}\n`);
  const risks = new Map<string, string>(Object.entries(result.lock.capabilities).map(([id, e]: [string, any]) => [id.replace(/[^a-zA-Z0-9_-]/g, '_'), e.risk]));
  for (const tool of result.tools) {
    const risk = risks.get(tool.name) ?? (tool.name === 'nav_goto' ? 'navigate' : tool.name === 'page_act' ? 'per element' : tool.name.startsWith('ui_') ? 'ui' : 'read');
    console.log(`  ${cyan(tool.name.padEnd(28))} ${riskLabel(risk)}  ${dim(String(tool.description).split('\n')[0]!.slice(0, 70))}`);
  }
  if (flags.instructions) console.log(`\n${dim(result.instructions)}`);
  console.log('');
  return 0;
}

function riskLabel(risk: string): string {
  const padded = risk.padEnd(12);
  if (risk === 'read' || risk === 'navigate' || risk === 'ui') return green(padded);
  if (risk === 'reversible') return cyan(padded);
  if (risk === 'never' || risk === 'destructive') return red(padded);
  return yellow(padded);
}

function actions(dir: string): number {
  const lock = parseLock(fs.existsSync(path.join(dir, LOCKFILE_NAME)) ? fs.readFileSync(path.join(dir, LOCKFILE_NAME), 'utf8') : null);
  if (!lock) {
    console.log(`No ${LOCKFILE_NAME} yet. Start your dev server once (or build) and it will be written.`);
    return 1;
  }
  console.log(`\n${bold('Actions the assistant can take')}  ${dim(`(${LOCKFILE_NAME})`)}\n`);
  for (const [id, entry] of Object.entries(lock.capabilities)) {
    console.log(`  ${cyan(id.padEnd(28))} ${riskLabel(entry.risk)} ${dim(`${entry.kind} · ${entry.expose.join(', ')}`)}`);
  }
  if (lock.sources?.length) console.log(`\n  ${bold('Tool sources')}: ${lock.sources.join(', ')}`);
  console.log(`\n  ${bold('Pages')}: ${lock.routes.join('  ')}\n`);
  console.log(dim('  Plus everything on screen: page reading and element actions follow `see` / `act` in saydo.config.ts.\n'));
  return 0;
}

function routes(dir: string): number {
  const scan = scanProject(dir);
  if (!scan.appDir) {
    console.log('No app/ directory found. For Vite apps, pages are declared in saydo.routes.ts.');
    return 1;
  }
  console.log(`\n${bold('Pages found in')} ${dim(path.relative(dir, scan.appDir) || '.')}\n`);
  for (const route of scan.routes) {
    const dynamic = route.pattern.includes('[');
    const note = route.nav ? green('nav.ts') : dynamic ? yellow('needs nav.ts params to be reachable') : '';
    console.log(`  ${cyan(route.pattern.padEnd(30))} ${note}`);
  }
  for (const warning of scan.warnings) console.log(yellow(`  ! ${warning}`));
  console.log(`\n  ${dim(`${scan.capabilityFiles.length} capability file(s) found.`)}\n`);
  return 0;
}

async function doctor(dir: string, flags: Args['flags']): Promise<number> {
  const { framework, pkg } = detect(dir);
  const checks: Array<[boolean | 'warn', string]> = [];
  const version = (name: string) => String(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name] ?? '');
  checks.push([Boolean(pkg), 'package.json found']);
  checks.push([framework !== 'unknown', `framework: ${framework === 'next' ? 'Next.js' : framework === 'vite' ? 'Vite + React' : 'not detected'}`]);
  checks.push([Boolean(version('saydo-js')), 'saydo-js installed']);
  checks.push([Boolean(version('ai')), 'ai (AI SDK) installed']);
  if (framework === 'next') {
    const config = firstExisting(dir, ['next.config.ts', 'next.config.mjs', 'next.config.mts', 'next.config.js']);
    checks.push([Boolean(config && fs.readFileSync(config, 'utf8').includes('withSaydo')), 'next.config uses withSaydo()']);
    const appDir = findAppDir(dir);
    const layout = appDir && firstExisting(appDir, ['layout.tsx', 'layout.jsx', 'layout.js']);
    checks.push([Boolean(layout && fs.readFileSync(layout, 'utf8').includes('SaydoProvider')), 'root layout renders <SaydoProvider>']);
    checks.push([Boolean(appDir && firstExisting(appDir, ['api/saydo/route.ts', 'api/saydo/route.js'])), 'route handler at app/api/saydo/route.ts']);
  }
  if (framework === 'vite') {
    const config = firstExisting(dir, ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']);
    checks.push([Boolean(config && /\bsaydo\(/.test(fs.readFileSync(config, 'utf8'))), 'vite.config uses saydo()']);
    checks.push([Boolean(firstExisting(dir, ['saydo.routes.ts', 'src/saydo.routes.ts'])), 'saydo.routes.ts lists your pages']);
  }
  checks.push([firstExisting(dir, ['saydo.config.ts', 'saydo.config.mts', 'saydo.config.js', 'saydo.config.mjs']) ? true : 'warn', 'saydo.config.ts (model, user, tools)']);
  checks.push([process.env.SAYDO_SECRET ? true : 'warn', 'SAYDO_SECRET set (required in production; dev generates one)']);
  checks.push([fs.existsSync(path.join(dir, LOCKFILE_NAME)) ? true : 'warn', `${LOCKFILE_NAME} committed (written on first dev run)`]);
  const url = String(flags.url ?? 'http://localhost:3000');
  const overlaps: string[] = [];
  try {
    const result = await call(url, { type: 'inspect', client: clientFor('/') });
    checks.push([result.ok === true, `dev server at ${url} answers (${result.tools?.length ?? 0} tools on /)`]);
    overlaps.push(...descriptionOverlaps(result.tools ?? []));
    checks.push([overlaps.length ? 'warn' : true, overlaps.length ? `${overlaps.length} pair(s) of actions with overlapping descriptions` : 'action descriptions are distinct']);
  } catch {
    checks.push(['warn', `dev server at ${url} not running (start it to check end to end)`]);
  }
  console.log(`\n${bold('saydo doctor')}\n`);
  for (const [ok, label] of checks) console.log(`  ${ok === true ? green('✓') : ok === 'warn' ? yellow('!') : red('✗')} ${label}`);
  for (const line of overlaps) console.log(`      ${dim(line)}`);
  console.log('');
  return checks.some(([ok]) => ok === false) ? 1 : 0;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'user', 'users', 'into', 'optionally', 'one', 'more']);
const words = (text: string) =>
  new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/s$/, '')));

/** Pairs of actions whose descriptions are so similar the model may pick the wrong one. */
export function descriptionOverlaps(tools: Array<{ name: string; description: string }>, threshold = 0.6): string[] {
  const own = tools.filter((t) => !['nav_goto', 'entities_find', 'page_act', 'find_capability'].includes(t.name));
  const out: string[] = [];
  for (let i = 0; i < own.length; i++) {
    for (let j = i + 1; j < own.length; j++) {
      const a = words(own[i]!.description);
      const b = words(own[j]!.description);
      const shared = [...a].filter((w) => b.has(w)).length;
      const score = shared / Math.max(1, new Set([...a, ...b]).size);
      if (score >= threshold) out.push(`${own[i]!.name} ≈ ${own[j]!.name} (${Math.round(score * 100)}% overlap): make their describe texts more specific`);
    }
  }
  return out;
}

interface EvalCase {
  say: string;
  /** Expected first tool (name like "posts_create" or id like "posts.create"), or "none" for a plain reply. */
  expect: string;
  route?: string;
}

async function evaluate(file: string, flags: Args['flags']): Promise<number> {
  let cases: EvalCase[];
  try {
    cases = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(red(`Could not read ${file}.`), `Create it with cases like ${cyan('[{ "say": "take me to billing", "expect": "nav_goto" }]')}.`);
    return 1;
  }
  const url = String(flags.url ?? 'http://localhost:3000');
  const norm = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_');
  let failed = 0;
  console.log(`\n${bold('saydo eval')} ${dim(`${cases.length} case(s) against ${url}`)}\n`);
  for (const test of cases) {
    const result = await call(url, { type: 'message', text: test.say, client: clientFor(test.route ?? '/') });
    const firstAction = result.events?.find((e: { type: string }) => e.type === 'action')?.capability;
    const pending = result.pending ? (result.pending.capability ?? result.pending.target) : undefined;
    const chosen = norm(String(firstAction ?? pending ?? 'none'));
    const pass = result.ok && chosen === norm(test.expect);
    if (!pass) failed++;
    console.log(`  ${pass ? green('✓') : red('✗')} ${test.say} ${dim(`→ ${chosen}${pass ? '' : ` (expected ${norm(test.expect)})`}`)}`);
  }
  console.log(`\n  ${failed ? red(`${failed} failed`) : green('all passed')}\n`);
  return failed ? 1 : 0;
}

function help() {
  console.log(`
${bold('saydo')} ${dim(`v${VERSION}`)}  Say it. It's done.

  ${cyan('saydo init')}                 Add Saydo to an existing Next.js or Vite + React app
                             ${dim('--install  also install packages')}
  ${cyan('saydo ask "<request>"')}      Try a request against your dev server (never approves anything)
                             ${dim('--route /posts/1   --url http://localhost:3000')}
  ${cyan('saydo inspect [path]')}       What the model sees on a page: tools and risks
  ${cyan('saydo actions')}              Every action the assistant can take, with its risk
  ${cyan('saydo routes')}               Pages found in app/ (Next.js)
  ${cyan('saydo doctor')}               Check your setup (and lint overlapping action descriptions)
  ${cyan('saydo eval [file]')}          Golden "user says → expected action" checks (default saydo.evals.json)

  New app: ${cyan('npx create-saydo-app my-app')}
`);
}

export async function main(argv: string[]): Promise<number> {
  const args = parse(argv);
  const dir = path.resolve(String(args.flags.dir ?? process.cwd()));
  if (args.flags.version) {
    console.log(VERSION);
    return 0;
  }
  try {
    switch (args.command) {
      case 'init':
        return init(dir, args.flags);
      case 'ask':
        return await ask(args.positional.join(' '), args.flags);
      case 'inspect':
        return await inspect(args.positional[0] ?? '/', args.flags);
      case 'actions':
      case 'capabilities':
        return actions(dir);
      case 'routes':
        return routes(dir);
      case 'doctor':
        return await doctor(dir, args.flags);
      case 'eval':
        return await evaluate(path.resolve(dir, args.positional[0] ?? 'saydo.evals.json'), args.flags);
      case 'help':
      default:
        help();
        return args.command === 'help' ? 0 : 1;
    }
  } catch (error) {
    console.error(red(error instanceof Error ? error.message : String(error)));
    return 1;
  }
}
