/**
 * Small, conservative source transforms used by `saydo init`. Each returns the
 * new source, or null when the shape is not recognized (the CLI then prints a
 * manual step instead of guessing).
 */

// Named, default, type and side-effect imports (`import './globals.css'`), single or multi-line.
const IMPORT_RE = /^import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"\n]+['"];?[ \t]*$/gm;

function addImport(source: string, line: string): string {
  if (source.includes(line)) return source;
  const imports = [...source.matchAll(IMPORT_RE)];
  const last = imports.at(-1);
  if (last && last.index !== undefined) {
    const end = last.index + last[0].length;
    return `${source.slice(0, end)}\n${line}${source.slice(end)}`;
  }
  const directive = /^(['"]use (client|server|strict)['"];?\s*\n)/.exec(source);
  if (directive) return `${directive[1]}${line}\n${source.slice(directive[1]!.length)}`;
  return `${line}\n${source}`;
}

/** next.config.(ts|mjs|js): wrap the default export with withSaydo(). */
export function wrapNextConfig(source: string): string | null {
  if (source.includes('withSaydo')) return source;
  if (/module\.exports\s*=/.test(source)) return null; // CommonJS: ask the user to switch to next.config.mjs/ts
  const named = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(source);
  let out: string;
  if (named) {
    out = source.replace(named[0], `export default withSaydo(${named[1]});\n`);
  } else {
    const start = source.search(/export\s+default\s+(\{|defineConfig\(|\(\s*\w*\s*\)\s*=>)/);
    if (start < 0) return null;
    const head = /export\s+default\s+/.exec(source.slice(start))![0];
    const exprStart = start + head.length;
    const lastSemicolonOrEnd = source.trimEnd().endsWith(';') ? source.trimEnd().length - 1 : source.trimEnd().length;
    const expr = source.slice(exprStart, lastSemicolonOrEnd).trim();
    out = `${source.slice(0, start)}export default withSaydo(${expr});\n`;
  }
  return addImport(out, "import { withSaydo } from 'saydo/next';");
}

/** Root layout: wrap {children} inside <body> with <SaydoProvider>. */
export function addProviderToLayout(source: string): string | null {
  if (source.includes('SaydoProvider')) return source;
  const body = /<body[^>]*>/.exec(source);
  if (!body || body.index === undefined) return null;
  const afterBody = body.index + body[0].length;
  const childrenAt = source.indexOf('{children}', afterBody);
  if (childrenAt < 0) return null;
  const out =
    source.slice(0, childrenAt) +
    '<SaydoProvider>{children}</SaydoProvider>' +
    source.slice(childrenAt + '{children}'.length);
  return addImport(out, "import { SaydoProvider } from 'saydo/next/client';");
}

/** vite.config.*: add saydo() to the plugins array. */
export function addVitePlugin(source: string): string | null {
  if (/\bsaydo\(\)/.test(source)) return source;
  const plugins = /plugins\s*:\s*\[/.exec(source);
  if (!plugins || plugins.index === undefined) return null;
  const at = plugins.index + plugins[0].length;
  const rest = source.slice(at).trimStart();
  const out = `${source.slice(0, at)}${rest.startsWith(']') ? 'saydo()' : 'saydo(), '}${rest}`;
  return addImport(out, "import { saydo } from 'saydo/vite';");
}

export const ROUTE_FILE = `// The whole assistant backend. Configuration lives in saydo.config.ts.
export { POST } from 'saydo/next/route';
`;

export function configFile(appName: string): string {
  return `import { defineConfig } from 'saydo/config';
// import { anthropic } from '@ai-sdk/anthropic';

export default defineConfig({
  appName: ${JSON.stringify(appName)},
  // Any AI SDK model. Without one, development uses a deterministic mock planner.
  // model: anthropic('claude-sonnet-5-5'),

  // Who is signed in (Auth.js, Clerk, Supabase, your session...).
  // getUser: async (request) => ({ id: 'user-id' }),

  // Full freedom by default: the assistant sees the visible page and can operate
  // every element; clicks you did not annotate ask the user first.
  // see: { page: true },
  // act: { elements: 'all', defaultRisk: 'write' },

  // Plug in MCP servers, AI SDK tools, OpenAPI specs or tRPC routers:
  // tools: [mcp({ url: 'https://…/mcp', risk: { search: 'read' } })],
});
`;
}

export const VITE_ROUTES_FILE = `import { pages } from 'saydo';

// Pages the assistant may open (React Router paths). Add titles and aliases for better matching.
export default pages([
  { path: '/', title: 'Home' },
]);
`;
