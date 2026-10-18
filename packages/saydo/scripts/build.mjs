// Builds the publishable package: ESM JavaScript in dist/, type declarations in dist/types/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
fs.rmSync('dist', { recursive: true, force: true });

const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {}), '@ai-sdk/mcp', 'server-only'];
const external = [...deps, ...deps.map((d) => `${d}/*`), 'saydo-js/registry', 'virtual:saydo/handler', 'node:*'];

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  splitting: true,
  sourcemap: true,
  jsx: 'automatic',
  external,
  logLevel: 'warning',
  chunkNames: 'chunks/[name]-[hash]',
};

// Server, isomorphic and tooling entries.
await build({
  ...common,
  platform: 'neutral',
  mainFields: ['module', 'main'],
  outdir: 'dist',
  entryPoints: {
    index: 'src/index.ts',
    server: 'src/server.ts',
    config: 'src/config.ts',
    handler: 'src/handler.ts',
    next: 'src/next.ts',
    'next-server': 'src/next-server.ts',
    'next-route': 'src/next-route.ts',
    'next-mcp': 'src/next-mcp.ts',
    vite: 'src/vite.ts',
    node: 'src/node.ts',
    registry: 'src/registry.ts',
    cli: 'src/cli/main.ts',
  },
});

// next.config files are loaded with require(): ship a self-contained CommonJS build of withSaydo.
await build({
  ...common,
  splitting: false,
  format: 'cjs',
  platform: 'node',
  outfile: 'dist/next.cjs',
  entryPoints: ['src/next.ts'],
  chunkNames: undefined,
});

// Client entries share one bundle so React context exists exactly once.
await build({
  ...common,
  platform: 'browser',
  outdir: 'dist/client',
  banner: { js: "'use client';" },
  entryPoints: {
    react: 'src/react.ts',
    'react-router': 'src/react-router.tsx',
    'next-client': 'src/next-client.tsx',
    'next-approve': 'src/next-approve.tsx',
  },
});

// Framework-free browser client: its own build, so it never shares a chunk with React code.
await build({
  ...common,
  platform: 'browser',
  outdir: 'dist/dom',
  entryPoints: { dom: 'src/dom.ts' },
});

execFileSync(process.execPath, [path.join(root, '../../node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
console.log('saydo: built dist/');
