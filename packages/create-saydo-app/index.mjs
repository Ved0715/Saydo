#!/usr/bin/env node
// create-saydo-app: scaffold an AI-native Next.js or React (Vite) app. No dependencies.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = paint(1);
const dim = paint(2);
const cyan = paint(36);
const green = paint(32);
const red = paint(31);

const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
const TEMPLATES = {
  next: 'Next.js App Router (recommended)',
  vite: 'React + Vite + React Router',
};

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (value !== undefined) flags[key] = value;
      else if (['template', 'pm'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('-')) flags[key] = argv[++i];
      else flags[key] = true;
    } else if (arg === '-y') flags.yes = true;
    else positional.push(arg);
  }
  return { flags, positional };
}

function detectPm(flag) {
  if (flag) return flag;
  const agent = process.env.npm_config_user_agent ?? '';
  if (agent.startsWith('pnpm')) return 'pnpm';
  if (agent.startsWith('yarn')) return 'yarn';
  if (agent.startsWith('bun')) return 'bun';
  return 'npm';
}

function copyTemplate(from, to, name) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const destName = entry.name === '_gitignore' ? '.gitignore' : entry.name === '_env.example' ? '.env.example' : entry.name;
    const dest = path.join(to, destName);
    if (entry.isDirectory()) copyTemplate(src, dest, name);
    else if (/\.(json|md)$/.test(entry.name)) fs.writeFileSync(dest, fs.readFileSync(src, 'utf8').replaceAll('{{name}}', name));
    else fs.copyFileSync(src, dest);
  }
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(`\n${bold('create-saydo-app')} [directory] [--template next|vite] [--pm npm|pnpm|yarn|bun] [--install] [--yes]\n`);
    return 0;
  }
  const interactive = process.stdin.isTTY && !flags.yes;
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (question, fallback) => (rl ? (await rl.question(`${question} ${dim(`(${fallback})`)} `)).trim() || fallback : fallback);

  console.log(`\n${bold('Saydo')} ${dim('· Say it. It’s done.')}\n`);
  const dirArg = positional[0] ?? (await ask('Project name:', 'my-saydo-app'));
  let template = flags.template;
  if (!template) {
    if (rl) {
      console.log(Object.entries(TEMPLATES).map(([k, v]) => `  ${cyan(k.padEnd(5))} ${v}`).join('\n'));
      template = await ask('Template:', 'next');
    } else template = 'next';
  }
  if (!TEMPLATES[template]) {
    console.error(red(`Unknown template "${template}".`), `Use one of: ${Object.keys(TEMPLATES).join(', ')}.`);
    rl?.close();
    return 1;
  }
  const target = path.resolve(dirArg);
  const name = path.basename(target).toLowerCase().replace(/[^a-z0-9-_.]/g, '-');
  if (fs.existsSync(target) && fs.readdirSync(target).length) {
    console.error(red(`${target} is not empty.`), 'Pick a new directory name.');
    rl?.close();
    return 1;
  }
  copyTemplate(path.join(templatesDir, template), target, name);
  console.log(`${green('✓')} Created ${bold(name)} ${dim(`(${TEMPLATES[template]})`)}`);

  const pm = detectPm(flags.pm);
  const install = flags.install || (rl ? /^y/i.test(await ask('Install dependencies now? [y/n]', 'y')) : false);
  rl?.close();
  if (install) {
    console.log(dim(`\n$ ${pm} install`));
    const result = spawnSync(pm, ['install'], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) {
      console.error(red('Install failed.'), `Run ${cyan(`${pm} install`)} in ${name} yourself.`);
      return result.status ?? 1;
    }
  }
  const run = pm === 'npm' ? 'npm run' : pm;
  const rel = path.relative(process.cwd(), target) || '.';
  console.log(`
${bold('Next steps')}
  ${cyan(`cd ${rel}`)}${install ? '' : `\n  ${cyan(`${pm} install`)}`}
  ${cyan(`${run} dev`)}

Open the app and press ${bold('⌘K')} (Ctrl K). It already works without an API key (deterministic mock planner).
For a real model: put ${cyan('ANTHROPIC_API_KEY=…')} in ${cyan('.env.local')}${template === 'vite' ? ' (or your shell)' : ''}.

Then: add actions in ${cyan('capabilities/')}, wrap Server Actions with ${cyan('serverAction()')},
or just let the assistant read and use your pages. ${dim('Docs: README.md')}
`);
  return 0;
}

process.exitCode = await main();
