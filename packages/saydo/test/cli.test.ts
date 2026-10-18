import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { addProviderToLayout, addVitePlugin, wrapNextConfig } from '../src/cli/codemods';
import { descriptionOverlaps, main } from '../src/cli/main';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saydo-cli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const CREATE_NEXT_APP_LAYOUT = `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Create Next App" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
`;

describe('codemods', () => {
  it('wraps the common next.config shapes and refuses CommonJS', () => {
    const named = wrapNextConfig(`import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  reactStrictMode: true,\n};\n\nexport default nextConfig;\n`)!;
    expect(named).toContain('export default withSaydo(nextConfig);');
    expect(named).toContain("import { withSaydo } from 'saydo-js/next';");
    const literal = wrapNextConfig(`export default {\n  images: { unoptimized: true },\n};\n`)!;
    expect(literal).toContain('export default withSaydo({\n  images: { unoptimized: true },\n});');
    expect(wrapNextConfig(`module.exports = { reactStrictMode: true };`)).toBeNull();
    expect(wrapNextConfig(named)).toBe(named);
  });

  it('adds the provider inside <body> of a create-next-app layout', () => {
    const out = addProviderToLayout(CREATE_NEXT_APP_LAYOUT)!;
    expect(out).toContain('<SaydoProvider>{children}</SaydoProvider>');
    expect(out).toContain("import { SaydoProvider } from 'saydo-js/next/client';");
    expect(out.indexOf("import { SaydoProvider }")).toBeGreaterThan(out.indexOf('import "./globals.css"'));
    expect(addProviderToLayout(out)).toBe(out);
    expect(addProviderToLayout('export default function L() { return null }')).toBeNull();
  });

  it('adds the Vite plugin', () => {
    const out = addVitePlugin(`import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n})\n`)!;
    expect(out).toContain('plugins: [saydo(), react()]');
    expect(out).toContain("import { saydo } from 'saydo-js/vite';");
    expect(addVitePlugin(`export default { plugins: [] }`)).toContain('plugins: [saydo()]');
  });
});

describe('description lint', () => {
  it('flags actions the model could confuse', () => {
    const lint = descriptionOverlaps([
      { name: 'posts_create', description: 'Create a new draft post' },
      { name: 'posts_draft', description: 'Create a draft post' },
      { name: 'billing_refund', description: 'Refund an invoice payment' },
      { name: 'nav_goto', description: 'Open a page' },
    ]);
    expect(lint).toHaveLength(1);
    expect(lint[0]).toContain('posts_create ≈ posts_draft');
  });
});

describe('saydo init', () => {
  const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => {});

  it('sets up a fresh Next.js app in place', async () => {
    const dir = path.join(tmp, 'next-app');
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'next-app', dependencies: { next: '16.4.2', react: '19.3.1' } }));
    fs.writeFileSync(path.join(dir, 'next.config.ts'), 'const nextConfig = {};\n\nexport default nextConfig;\n');
    fs.writeFileSync(path.join(dir, 'app', 'layout.tsx'), CREATE_NEXT_APP_LAYOUT);
    fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export default function Page() { return <h1>Hi</h1> }\n');
    const spy = quiet();
    expect(await main(['init', '--dir', dir])).toBe(0);
    spy.mockRestore();
    expect(fs.readFileSync(path.join(dir, 'next.config.ts'), 'utf8')).toContain('withSaydo(nextConfig)');
    expect(fs.readFileSync(path.join(dir, 'app', 'layout.tsx'), 'utf8')).toContain('<SaydoProvider>{children}</SaydoProvider>');
    expect(fs.readFileSync(path.join(dir, 'app', 'api', 'saydo', 'route.ts'), 'utf8')).toContain("export { POST } from 'saydo-js/next/route';");
    expect(fs.readFileSync(path.join(dir, 'saydo.config.ts'), 'utf8')).toContain('name: "next-app"');
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('.saydo');
    // The agent skill and the AGENTS.md section for coding agents.
    expect(fs.readFileSync(path.join(dir, '.claude', 'skills', 'saydo', 'SKILL.md'), 'utf8')).toMatch(/^---\nname: saydo\n/);
    expect(fs.existsSync(path.join(dir, '.claude', 'skills', 'saydo', 'references', 'configuration.md'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toContain('<!-- BEGIN:saydo-agent-rules -->');
    // Idempotent.
    const again = quiet();
    expect(await main(['init', '--dir', dir])).toBe(0);
    again.mockRestore();
    expect(fs.readFileSync(path.join(dir, 'app', 'layout.tsx'), 'utf8').match(/SaydoProvider>/g)).toHaveLength(2);
  });

  it('installs and updates the agent skill without touching the rest of AGENTS.md', async () => {
    const dir = path.join(tmp, 'skill-app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Team rules\n\nUse tabs.\n');
    const spy = quiet();
    expect(await main(['skill', '--dir', dir])).toBe(0);
    expect(await main(['skill', '--dir', dir])).toBe(0);
    spy.mockRestore();
    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith('# Team rules\n\nUse tabs.\n')).toBe(true);
    expect(agents.match(/BEGIN:saydo-agent-rules/g)).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, '.claude', 'skills', 'saydo', 'references', 'troubleshooting.md'))).toBe(true);
  });

  it('sets up a Vite + React app', async () => {
    const dir = path.join(tmp, 'vite-app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'vite-app', dependencies: { react: '19.3.1' }, devDependencies: { vite: '8.3.4' } }));
    fs.writeFileSync(path.join(dir, 'vite.config.ts'), "import react from '@vitejs/plugin-react'\nexport default { plugins: [react()] }\n");
    const spy = quiet();
    expect(await main(['init', '--dir', dir])).toBe(0);
    spy.mockRestore();
    expect(fs.readFileSync(path.join(dir, 'vite.config.ts'), 'utf8')).toContain('saydo(), react()');
    expect(fs.existsSync(path.join(dir, 'saydo.routes.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'saydo.config.ts'))).toBe(true);
  });

  it('fails helpfully outside an app', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['init', '--dir', path.join(tmp, 'nope')])).toBe(1);
    expect(spy.mock.calls.flat().join(' ')).toContain('create-saydo-app');
    spy.mockRestore();
  });
});

describe('create-saydo-app', () => {
  const script = path.resolve(__dirname, '../../create-saydo-app/index.mjs');

  for (const template of ['next', 'vite']) {
    it(`scaffolds the ${template} template`, () => {
      const target = path.join(tmp, `created-${template}`);
      const result = spawnSync(process.execPath, [script, target, '--template', template, '--yes'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Next steps');
      const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
      expect(pkg.name).toBe(`created-${template}`);
      expect(pkg.dependencies['saydo-js']).toMatch(/^\^\d/);
      expect(fs.existsSync(path.join(target, '.gitignore'))).toBe(true);
      expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8').startsWith(`# created-${template}`)).toBe(true);
      expect(fs.existsSync(path.join(target, 'saydo.config.ts'))).toBe(true);
      expect(fs.existsSync(path.join(target, '.claude', 'skills', 'saydo', 'SKILL.md'))).toBe(true);
      expect(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8')).toContain('saydo-agent-rules');
    });
  }

  it('refuses to overwrite a non-empty directory', () => {
    const target = path.join(tmp, 'created-next');
    const result = spawnSync(process.execPath, [script, target, '--template', 'next', '--yes'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
  });
});
