import type { LanguageModel } from 'ai';
import { aiSdkPlanner } from './ai-sdk';
import type { Capability } from './capability';
import { GRANT_HEADER } from './constants';
import { createEngine, type AuditEntry, type Engine } from './engine';
import { MemoryGrantStore, type GrantStore } from './grants';
import { buildLock, diffLock, formatLockDiff, LOCKFILE_NAME, parseLock, serializeLock } from './lockfile';
import { mockPlanner, type Planner } from './planner';
import { seal, unseal } from './seal';
import type { RegistrationCredential, WebAuthnStepUp } from './webauthn';
import { isToolSource, type ToolEntry } from './sources';
import type { EngineOptions } from './engine';
import type { TurnError } from './protocol';
import type { RouteRecord } from './route';
import type { SaydoUser } from './types';

export { GRANT_HEADER };

/** Everything configurable, usually written once in `saydo.config.ts`. */
export interface SaydoOptions {
  /** Any AI SDK model. Omit in dev to use the deterministic mock planner. */
  model?: LanguageModel;
  /** Bring your own planner (custom agent, AG-UI backend). The gate still applies. */
  planner?: Planner;
  /** Resolve the signed-in user. Defaults to an anonymous user (fine for navigation-only apps). */
  getUser?: (request: Request) => SaydoUser | null | undefined | Promise<SaydoUser | null | undefined>;
  /** Signs thread state. Defaults to SAYDO_SECRET, or a generated dev secret. */
  secret?: string;
  /** Durable grant store. `'memory'` opts into the in-process store (single-instance servers only). */
  store?: GrantStore | 'memory';
  appName?: string;
  instructions?: string;
  /** Requests per user per minute. Default 30; `false` disables. */
  rateLimit?: number | false;
  maxSteps?: number;
  audit?: (entry: AuditEntry) => void;
  /** Extra capabilities added to the discovered ones. */
  capabilities?: Capability[];
  /**
   * External tools and APIs: mcp(...), aiTools(...), fromOpenAPI(...), fromTRPC(...),
   * or plain capabilities. Unmapped tools default to 'destructive' (confirm).
   */
  tools?: ToolEntry[];
  /** What the assistant may see. Default: the visible page ({ page: true }). */
  see?: EngineOptions['see'];
  /** What it may operate. Default: every visible element, unannotated clicks confirmed. */
  act?: EngineOptions['act'];
  /** Tool-search threshold for large apps. Default 40. */
  maxTools?: number;
  /** Mask sensitive patterns before anything reaches the model. Default 'basic' (cards, SSNs, IBANs). */
  redact?: EngineOptions['redact'];
  /** Per-user daily limits (per server instance; use your gateway for global limits). */
  budget?: { requestsPerDay?: number; tokensPerDay?: number };
  /** Token usage per request: wire it to metrics and spend alerts. */
  onUsage?: EngineOptions['onUsage'];
  /** Model prices per million tokens; usage entries then carry `costUsd`. */
  pricing?: EngineOptions['pricing'];
  /** OpenTelemetry tracer (`trace.getTracer('saydo')`): spans per model step and per action. */
  tracer?: EngineOptions['tracer'];
  /** Passkey step-up for the riskiest approvals: `webauthn({ … })` from 'saydo/server'. */
  stepUp?: EngineOptions['stepUp'];
  /** Confirmations per request before further ones need step-up. Default 5. */
  confirmBudget?: number;
  /**
   * Agents outside the in-app assistant. MCP clients authenticate with `authenticate`
   * (for example a personal access token); only actions with `expose.external` are visible.
   */
  external?: NonNullable<EngineOptions['external']> & {
    authenticate?: (request: Request) => SaydoUser | null | undefined | Promise<SaydoUser | null | undefined>;
    /** Public origin for approval links, e.g. 'https://app.example.com'. Default: the request origin. */
    appOrigin?: string;
  };
  /** Recorded on audit entries. Default: VERCEL_DEPLOYMENT_ID or NEXT_DEPLOYMENT_ID. */
  deploymentId?: string;
  /** Path of the capability lockfile, or false to disable it. Default `saydo.capabilities.json` in cwd. */
  lockfile?: string | false;
}

export type SaydoConfig = SaydoOptions;

/** Typed helper for `saydo.config.ts`. */
export function defineConfig(config: SaydoConfig): SaydoConfig {
  return config;
}

export interface Registry {
  routes: RouteRecord[];
  capabilities: Capability[];
  devSecret?: string;
  config?: SaydoConfig;
}

interface Runtime {
  engine: Engine;
  getUser: (request: Request) => Promise<SaydoUser | null>;
  store: GrantStore;
  secret: string;
}

const RUNTIME_KEY = Symbol.for('saydo.runtime');
const STORE_KEY = Symbol.for('saydo.memory-store');
const g = globalThis as Record<symbol, unknown>;

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const problem = (status: number, error: Omit<TurnError, 'ok'>) => json({ ok: false, ...error }, status);

function sameOrigin(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Opens after repeated model-provider failures so a provider outage does not become a request storm. */
function createCircuitBreaker(threshold = 5, coolDownMs = 30_000) {
  let failures = 0;
  let openUntil = 0;
  return {
    open: () => Date.now() < openUntil,
    record(failed: boolean) {
      if (!failed) {
        failures = 0;
        return;
      }
      failures += 1;
      if (failures >= threshold) {
        openUntil = Date.now() + coolDownMs;
        failures = 0;
      }
    },
  };
}

function createBudget(limits: NonNullable<SaydoOptions['budget']>) {
  const day = () => new Date().toISOString().slice(0, 10);
  const usage = new Map<string, { day: string; requests: number; tokens: number }>();
  const entry = (userId: string) => {
    const today = day();
    let current = usage.get(userId);
    if (!current || current.day !== today) {
      current = { day: today, requests: 0, tokens: 0 };
      usage.set(userId, current);
      if (usage.size > 50_000) usage.clear();
    }
    return current;
  };
  return {
    exceeded(userId: string) {
      const current = entry(userId);
      return (
        (limits.requestsPerDay !== undefined && current.requests >= limits.requestsPerDay) ||
        (limits.tokensPerDay !== undefined && current.tokens >= limits.tokensPerDay)
      );
    },
    countRequest(userId: string) {
      entry(userId).requests += 1;
    },
    countTokens(userId: string, tokens: number) {
      entry(userId).tokens += tokens;
    },
  };
}

function createRateLimiter(perMinute: number) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10_000) hits.clear();
    return recent.length > perMinute;
  };
}

type FsModule = typeof import('node:fs');
type PathModule = typeof import('node:path');

/** Node builtins without a static import, so this module still bundles for edge runtimes. */
function nodeBuiltins(): { fs: FsModule; path: PathModule } | null {
  const proc = globalThis.process as (NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }) | undefined;
  if (!proc?.getBuiltinModule) return null;
  try {
    return { fs: proc.getBuiltinModule('node:fs') as FsModule, path: proc.getBuiltinModule('node:path') as PathModule };
  } catch {
    return null;
  }
}

/**
 * Keep `saydo.capabilities.json` in sync. Dev and local builds update it (and
 * warn on lowered risk); CI builds fail when it is stale, like a frozen lockfile.
 */
export function syncLockfile(
  capabilities: Capability[],
  routes: RouteRecord[],
  target: string | false | undefined,
  mode: 'update' | 'verify',
  sources: string[] = [],
) {
  if (target === false) return;
  const node = nodeBuiltins();
  if (!node) return;
  const file = node.path.resolve(target ?? LOCKFILE_NAME);
  let previousText: string | null = null;
  try {
    previousText = node.fs.readFileSync(file, 'utf8');
  } catch {
    // no lockfile yet
  }
  const next = buildLock(capabilities, routes, sources);
  const previous = parseLock(previousText);
  const diff = diffLock(previous, next);
  if (!diff.changed) return;
  const summary = formatLockDiff(diff);
  if (mode === 'verify') {
    throw new Error(
      `[saydo] ${LOCKFILE_NAME} is out of date:\n${summary}\nFix: run \`next dev\` (or a local build) to update it, review the diff, and commit it.`,
    );
  }
  node.fs.writeFileSync(file, serializeLock(next));
  if (previous && diff.needsReview) {
    console.warn(`[saydo] Capability safety changed (review ${LOCKFILE_NAME} in your PR):\n${summary}`);
  }
}

/** Build the handler from a registry. `saydo/next/route` and the Vite plugin do this for you. */
/** A route handler: `export const POST = createHandler(…)`. */
export type SaydoHandler = (request: Request) => Promise<Response>;

export function createHandler(registry: Registry, overrides: SaydoOptions = {}): SaydoHandler {
  const options: SaydoOptions = { ...registry.config, ...overrides };
  const dev = process.env.NODE_ENV !== 'production';
  const limited = options.rateLimit === false ? () => false : createRateLimiter(options.rateLimit ?? 30);
  const breaker = createCircuitBreaker();
  const budget = options.budget ? createBudget(options.budget) : undefined;
  const staticTools = (options.tools ?? []).filter((t): t is Capability => !isToolSource(t));
  const sources = (options.tools ?? []).filter(isToolSource);
  const sourceNames = sources.map((s) => s.name);
  const allCapabilities = [...registry.capabilities, ...(options.capabilities ?? []), ...staticTools];
  let runtime: Promise<Runtime | { error: Omit<TurnError, 'ok'> }> | undefined;
  let warnedAnonymous = false;

  // Next evaluates route modules during `next build`: the moment to check the lockfile.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    syncLockfile(allCapabilities, registry.routes, options.lockfile, process.env.CI ? 'verify' : 'update', sourceNames);
  }

  const getUser = async (request: Request): Promise<SaydoUser | null> => {
    if (options.getUser) return (await options.getUser(request)) ?? null;
    return { id: 'anonymous' };
  };

  // Lazy (and cached) so configuration problems surface as responses with a fix instead of breaking the build.
  function init(): Promise<Runtime | { error: Omit<TurnError, 'ok'> }> {
    runtime ??= initialize();
    return runtime;
  }

  async function loadSources(): Promise<Capability[]> {
    const loaded: Capability[] = [];
    for (const source of sources) {
      try {
        loaded.push(...(await source.load()));
      } catch (error) {
        console.error(`[saydo] Could not load tool source ${source.name}; its tools are unavailable (fix: check its URL and credentials).`, error);
      }
    }
    return loaded;
  }

  async function initialize(): Promise<Runtime | { error: Omit<TurnError, 'ok'> }> {
    const secret = options.secret ?? process.env.SAYDO_SECRET ?? registry.devSecret;
    if (!secret || secret.length < 32) {
      return {
        error: {
          status: 'error',
          message: 'SAYDO_SECRET is not set.',
          fix: 'Set SAYDO_SECRET to a random string of at least 32 characters (for example `openssl rand -hex 32`).',
        },
      };
    }
    const gated = allCapabilities.some((c) => c.resolvedRisk !== 'read');
    let store: GrantStore;
    if (options.store && options.store !== 'memory') store = options.store;
    else if (options.store === 'memory' || dev || !gated) {
      store = (g[STORE_KEY] ??= new MemoryGrantStore()) as GrantStore;
    } else {
      return {
        error: {
          status: 'error',
          message: 'No durable grant store is configured for gated capabilities.',
          fix: "Set `store` in saydo.config.ts (Redis/Postgres adapter), or `store: 'memory'` for a single-instance server.",
        },
      };
    }
    let planner = options.planner ?? (options.model ? aiSdkPlanner({ model: options.model }) : undefined);
    if (!planner) {
      if (!dev) {
        return {
          error: { status: 'error', message: 'No model configured.', fix: 'Set `model` (any AI SDK model) in saydo.config.ts.' },
        };
      }
      console.warn('[saydo] No model configured; using the deterministic mock planner (dev only).');
      planner = mockPlanner();
    }
    if (dev) {
      try {
        syncLockfile(allCapabilities, registry.routes, options.lockfile, 'update', sourceNames);
      } catch (error) {
        console.warn(error);
      }
    }
    const fromSources = await loadSources();
    const engine = createEngine({
      capabilities: [...allCapabilities, ...fromSources],
      see: options.see,
      act: options.act,
      maxTools: options.maxTools,
      redact: options.redact,
      stepUp: options.stepUp,
      confirmBudget: options.confirmBudget,
      external: options.external,
      pricing: options.pricing,
      tracer: options.tracer,
      deploymentId: options.deploymentId ?? process.env.VERCEL_DEPLOYMENT_ID ?? process.env.NEXT_DEPLOYMENT_ID,
      onUsage: (entry) => {
        budget?.countTokens(entry.userId, entry.inputTokens + entry.outputTokens);
        options.onUsage?.(entry);
      },
      routes: registry.routes,
      planner,
      secret,
      grants: store,
      appName: options.appName,
      instructions: options.instructions,
      maxSteps: options.maxSteps,
      audit: options.audit,
    });
    const ready: Runtime = { engine, getUser, store, secret };
    g[RUNTIME_KEY] = ready; // shared with withGrant() in other route bundles
    return ready;
  }

  const POST = async function POST(request: Request): Promise<Response> {
    if (!sameOrigin(request)) {
      return problem(403, { status: 'forbidden', message: 'Cross-site requests are not allowed.', fix: 'Call this endpoint from your own origin.' });
    }
    // JSON only: cross-site forms cannot send it without a CORS preflight.
    if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
      return problem(415, { status: 'invalid_args', message: 'Expected application/json.', fix: 'Send JSON with content-type: application/json.' });
    }
    if (Number(request.headers.get('content-length') ?? 0) > 256_000) {
      return problem(413, { status: 'invalid_args', message: 'Request too large.', fix: 'Send a shorter message.' });
    }
    let body: { type?: string } & Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return problem(400, { status: 'invalid_args', message: 'Expected a JSON body.', fix: 'Send JSON.' });
    }
    const ready = await init();
    if ('error' in ready) return problem(500, ready.error);

    const user = await ready.getUser(request);
    if (!user) return problem(401, { status: 'forbidden', message: 'Sign in to use the assistant.', fix: 'Sign in.' });
    if (!options.getUser && !warnedAnonymous && allCapabilities.some((c) => c.resolvedRisk !== 'read')) {
      warnedAnonymous = true;
      console.warn('[saydo] Gated capabilities exist but no getUser is configured; every request runs as "anonymous". Set getUser in saydo.config.ts.');
    }

    if (body.type === 'manifest') return json(await ready.engine.manifest(user));
    if (body.type === 'inspect') {
      // Dev-only window into what the model would see (used by `saydo ask` and `saydo doctor`).
      if (!dev) return problem(404, { status: 'not_found', message: 'Not available in production.', fix: 'Use it in development.' });
      return json({
        ok: true,
        lock: buildLock(allCapabilities, registry.routes, sourceNames),
        ...(await ready.engine.inspect(user, (body.client ?? {}) as never)),
      });
    }
    if (limited(user.id)) {
      return problem(429, { status: 'error', message: 'Too many assistant requests.', fix: 'Wait a minute and try again.' });
    }
    if (typeof body.type === 'string' && body.type.startsWith('passkey-')) return passkeys(ready, user, body, request);
    if (body.type === 'grant-status') return json(await ready.engine.grantStatus(user, String(body.grantId ?? '')));
    if (body.type === 'grant-approve') {
      return json(
        await ready.engine.approveDelegated(user, {
          grantId: String(body.grantId ?? ''),
          approved: body.approved === true,
          trusted: body.trusted === true,
          typed: typeof body.typed === 'string' ? body.typed : undefined,
          proof: body.proof,
          request,
        }),
      );
    }
    if (budget?.exceeded(user.id)) {
      return problem(429, { status: 'error', message: 'Daily assistant limit reached.', fix: 'Try again tomorrow, or use the app directly.', code: 'budget' });
    }
    if (body.type === 'message' && breaker.open()) {
      return problem(503, {
        status: 'error',
        message: 'The AI model is unavailable right now.',
        fix: 'Use ⌘K to jump to pages, or try again in a minute.',
        code: 'planner_unavailable',
      });
    }
    budget?.countRequest(user.id);
    if (body.type === 'invoke') {
      // In-page browser agents (WebMCP): same policy; gated calls show the normal confirm card.
      return json(await ready.engine.invoke(user, { tool: String(body.tool ?? ''), args: body.args, origin: 'browser-agent', request }));
    }
    const result = await ready.engine.handle(body as never, user, { request });
    breaker.record(!result.ok && result.code === 'planner_unavailable');
    return json(result);
  };
  return Object.assign(POST, { [RUNTIME_INIT]: init, [HANDLER_OPTIONS]: options, [HANDLER_LIMITS]: { limited, budget } });
}

/** Internal: lets the MCP handler share the main handler's engine and limits. */
export const RUNTIME_INIT = Symbol.for('saydo.runtime-init');
export const HANDLER_OPTIONS = Symbol.for('saydo.handler-options');
export const HANDLER_LIMITS = Symbol.for('saydo.handler-limits');
export type { Runtime };

/** Passkey management for the signed-in user: register, list and remove (all gated by allowRegistration). */
async function passkeys(runtime: Runtime, user: SaydoUser, body: Record<string, unknown>, request: Request): Promise<Response> {
  const stepUp = runtime.engine.stepUp as WebAuthnStepUp | undefined;
  if (!stepUp?.registration) {
    return problem(404, { status: 'not_found', message: 'Passkeys are not enabled.', fix: 'Set stepUp: webauthn({ … }) in saydo.config.ts.' });
  }
  if (!(await stepUp.registration.allowed(user, request))) {
    return problem(403, {
      status: 'forbidden',
      message: 'Managing passkeys is not allowed for this session.',
      fix: 'Pass allowRegistration to webauthn(), for example requiring a recent sign-in.',
    });
  }
  if (body.type === 'passkey-options') {
    const publicKey = await stepUp.registration.options(user);
    const token = await seal({ k: 'passkey', u: user.id, c: publicKey.challenge, exp: Date.now() + 5 * 60_000 }, runtime.secret);
    return json({ ok: true, publicKey, token });
  }
  if (body.type === 'passkey-register') {
    const sealed = await unseal<{ k: string; u: string; c: string; exp: number }>(String(body.token ?? ''), runtime.secret);
    if (!sealed || sealed.k !== 'passkey' || sealed.u !== user.id || Date.now() > sealed.exp) {
      return problem(400, { status: 'expired', message: 'The passkey request expired.', fix: 'Start passkey setup again.' });
    }
    const claimed = await runtime.store.claim({
      id: `passkey:${sealed.c}`,
      kind: 'request',
      capabilityId: '',
      userId: user.id,
      threadId: '',
      tabId: '',
      toolCallId: '',
      args: null,
      tier: 0,
      state: 'consumed',
      createdAt: Date.now(),
      expiresAt: sealed.exp,
    });
    if (!claimed) return problem(409, { status: 'expired', message: 'This passkey request was already used.', fix: 'Start passkey setup again.' });
    try {
      const passkey = await stepUp.registration.verify(user, body.credential as RegistrationCredential, sealed.c, typeof body.name === 'string' ? body.name : undefined);
      return json({ ok: true, passkey: { id: passkey.id, name: passkey.name, createdAt: passkey.createdAt } });
    } catch (error) {
      return problem(400, { status: 'invalid_args', message: error instanceof Error ? error.message : 'Registration failed.', fix: 'Try again.' });
    }
  }
  return problem(400, { status: 'invalid_args', message: 'Unknown passkey request.', fix: 'Use passkey-options or passkey-register.' });
}

export interface WithGrantOptions {
  /** Check that this request is the approved action. Receives the parsed JSON body and the approved (resolved) args. */
  match?: (input: { body: unknown; args: unknown; request: Request }) => boolean | Promise<boolean>;
}

/**
 * Wrap an existing route handler that an AI-dispatched client capability calls.
 * Requests carrying a grant header must match a single-use approval; requests
 * without one are ordinary human requests from your UI and pass through.
 */
export function withGrant<C>(
  capability: Capability | string,
  handler: (request: Request, context: C) => Response | Promise<Response>,
  options: WithGrantOptions = {},
) {
  const capabilityId = typeof capability === 'string' ? capability : capability.id;
  return async (request: Request, context: C): Promise<Response> => {
    const token = request.headers.get(GRANT_HEADER);
    if (!token) return handler(request, context);
    const runtime = g[RUNTIME_KEY] as Runtime | undefined;
    if (!runtime) {
      return problem(503, {
        status: 'error',
        message: 'The assistant runtime is not initialized.',
        fix: 'Make sure the saydo route handler is set up (app/api/saydo/route.ts).',
      });
    }
    const user = await runtime.getUser(request);
    if (!user) return problem(401, { status: 'forbidden', message: 'Sign in.', fix: 'Sign in.' });
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      body = undefined;
    }
    const result = await runtime.engine.consumeClientGrant(token, {
      capabilityId,
      user,
      body,
      match: options.match ? (b, args) => options.match!({ body: b, args, request }) : undefined,
    });
    if (!result.ok) return json(result, result.status === 'expired' ? 410 : 403);
    return handler(request, context);
  };
}
