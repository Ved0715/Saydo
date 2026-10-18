// Verifies that every entry in package.json "exports" points at built files, and that
// the server-side entries load in plain Node (catches bundling and externals mistakes).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const problems = [];

for (const [entry, conditions] of Object.entries(pkg.exports)) {
  if (typeof conditions === 'string') continue;
  for (const [condition, target] of Object.entries(conditions)) {
    if (condition === 'saydo-source') continue;
    if (!fs.existsSync(path.join(root, target))) problems.push(`${entry} [${condition}] → ${target} is missing`);
  }
}

// Entries that must import without a bundler (no React, no Next runtime needed).
const nodeSafe = ['.', './server', './config', './handler', './node'];
for (const entry of nodeSafe) {
  const target = pkg.exports[entry]?.import;
  try {
    await import(pathToFileURL(path.join(root, target)).href);
  } catch (error) {
    problems.push(`${entry} failed to import: ${error.message}`);
  }
}
try {
  const required = createRequire(import.meta.url)(path.join(root, pkg.exports['./next'].require));
  if (typeof required.withSaydo !== 'function') problems.push('./next (require) does not export withSaydo');
} catch (error) {
  problems.push(`./next (require) failed: ${error.message}`);
}

const bin = path.join(root, pkg.bin.saydo);
if (!fs.existsSync(bin)) problems.push(`bin ${pkg.bin.saydo} is missing`);

if (problems.length) {
  console.error(`saydo exports check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`saydo: ${Object.keys(pkg.exports).length} exports OK`);
