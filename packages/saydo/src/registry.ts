// Placeholder for the generated registry. withSaydo() (Next.js) and the saydo()
// Vite plugin replace this module at build time with your routes and actions.
import type { SaydoConfig } from './core/handler';
import type { Capability } from './core/capability';
import type { RouteRecord } from './core/route';

export declare const routes: RouteRecord[];
export declare const capabilities: Capability[];
export declare const config: SaydoConfig;
export declare const devSecret: string | undefined;

throw new Error(
  '[saydo] The registry is not configured (fix: wrap next.config with withSaydo(), or add saydo() to your Vite plugins).',
);
