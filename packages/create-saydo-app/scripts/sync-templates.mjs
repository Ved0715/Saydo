// Copies the starter apps into templates/, swapping workspace links for published versions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const saydoVersion = JSON.parse(fs.readFileSync(path.join(repo, 'packages/saydo/package.json'), 'utf8')).version;
const SKIP = new Set(['node_modules', '.next', '.saydo', 'dist', 'dist-server', 'next-env.d.ts', 'AGENTS.md', 'tsconfig.tsbuildinfo']);
const RENAME = { '.gitignore': '_gitignore', '.env.example': '_env.example' };

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, RENAME[entry.name] ?? entry.name);
    if (entry.isDirectory()) copy(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

for (const [template, example] of [['next', 'next-starter'], ['vite', 'vite-starter']]) {
  const out = path.join(here, '..', 'templates', template);
  fs.rmSync(out, { recursive: true, force: true });
  copy(path.join(repo, 'examples', example), out);
  const pkgPath = path.join(out, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.name = '{{name}}';
  pkg.version = '0.1.0';
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [dep, version] of Object.entries(pkg[field] ?? {})) {
      if (String(version).startsWith('workspace:')) pkg[field][dep] = `^${saydoVersion}`;
      else if (/^\d/.test(version)) pkg[field][dep] = `^${version}`;
    }
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const readme = path.join(out, 'README.md');
  if (fs.existsSync(readme)) fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/^# .*/, '# {{name}}'));
  // The agent skill and AGENTS.md section, so coding agents know Saydo from the first prompt.
  // Stored as _claude (npm and some tools drop dot-folders); create-saydo-app renames it.
  copy(path.join(repo, 'packages/saydo/skill'), path.join(out, '_claude', 'skills', 'saydo'));
  fs.writeFileSync(path.join(out, 'AGENTS.md'), fs.readFileSync(path.join(repo, 'packages/saydo/AGENTS.section.md'), 'utf8'));
  if (!fs.existsSync(path.join(out, '_gitignore'))) {
    fs.writeFileSync(path.join(out, '_gitignore'), 'node_modules\n.next\ndist\ndist-server\n.saydo\n.env*.local\n.env\n');
  }
  console.log(`synced templates/${template}`);
}
