import fs from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import { generateRegistry, OUT_DIR, REGISTRY_FILE } from './generate';

export interface WithSaydoOptions {
  /** Project root. Defaults to process.cwd(). */
  dir?: string;
  /** Folders scanned for capability modules. Default: capabilities/, src/capabilities/ (+ app/**\/capabilities.ts). */
  capabilityDirs?: string[];
  /** Regenerate the registry when app/ or capabilities change in dev. Default true. */
  watch?: boolean;
  /**
   * In-page browser agents (WebMCP). By default pages are served with
   * `Permissions-Policy: tools=()`, so no script on the page (a tag manager, a compromised
   * dependency) can register tools for browser agents. Set `agents: true` when you use
   * `<SaydoProvider agents>` (the policy becomes `tools=(self)`), or `permissionsPolicy: false`
   * to manage the header yourself.
   */
  agents?: boolean;
  permissionsPolicy?: boolean;
}

/** The WebMCP policy-controlled feature is "tools" (default allowlist 'self'). */
export const toolsPolicy = (agents: boolean | undefined) => (agents ? 'tools=(self)' : 'tools=()');

const WATCHING = Symbol.for('saydo.watching');
const PACKAGES = ['saydo'];

function watch(dir: string, options: WithSaydoOptions) {
  const g = globalThis as Record<symbol, unknown>;
  if (g[WATCHING]) return;
  g[WATCHING] = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const regenerate = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        generateRegistry(dir, { dev: true, capabilityDirs: options.capabilityDirs });
      } catch (error) {
        console.warn('[saydo] could not regenerate the registry:', error);
      }
    }, 150);
  };
  const roots = ['app', 'src/app', ...(options.capabilityDirs ?? ['capabilities', 'src/capabilities'])];
  for (const root of roots) {
    const full = path.join(dir, root);
    if (!fs.existsSync(full)) continue;
    try {
      fs.watch(full, { recursive: true }, (_event, file) => {
        if (file && /(^|[/\\])(page|nav|capabilities)\.|capabilities/.test(String(file))) regenerate();
        else if (file && !String(file).includes('.')) regenerate(); // folder added or removed
      }).unref?.();
    } catch {
      // recursive watch unsupported: restart dev to pick up new routes
    }
  }
}

/**
 * Wrap your Next config. Scans app/ and capabilities/ at startup, writes
 * `.saydo/registry.ts`, aliases `saydo/registry` to it, and transpiles the
 * saydo packages. Nothing to run by hand.
 */
export function withSaydo(nextConfig: NextConfig = {}, options: WithSaydoOptions = {}): NextConfig {
  const dir = options.dir ?? process.cwd();
  const dev = process.env.NODE_ENV !== 'production';
  const scan = generateRegistry(dir, { dev, capabilityDirs: options.capabilityDirs });
  for (const warning of scan.warnings) console.warn(`[saydo] ${warning}`);
  if (dev && options.watch !== false) watch(dir, options);

  const registryPath = path.join(dir, OUT_DIR, REGISTRY_FILE);
  const userWebpack = nextConfig.webpack;
  const userHeaders = nextConfig.headers;
  return {
    ...nextConfig,
    ...(options.permissionsPolicy === false
      ? {}
      : {
          async headers() {
            const own = userHeaders ? await userHeaders() : [];
            return [...own, { source: '/:path*', headers: [{ key: 'Permissions-Policy', value: toolsPolicy(options.agents) }] }];
          },
        }),
    transpilePackages: [...new Set([...(nextConfig.transpilePackages ?? []), ...PACKAGES])],
    turbopack: {
      ...nextConfig.turbopack,
      resolveAlias: {
        ...nextConfig.turbopack?.resolveAlias,
        'saydo/registry': `./${OUT_DIR}/${REGISTRY_FILE}`,
      },
    },
    webpack(config, context) {
      config.resolve ??= {};
      config.resolve.alias = { ...config.resolve.alias, 'saydo/registry': registryPath };
      return userWebpack ? userWebpack(config, context) : config;
    },
  };
}

export { scanProject, type ScanResult, type ScannedRoute } from './scan';
export { generateRegistry, fileIdFor, devSecret, OUT_DIR } from './generate';
