import type { LanguageModel } from 'ai';
import { aiSdkPlanner } from './ai-sdk';
import type { Capability } from './capability';
import { GRANT_HEADER } from './constants';
import { createEngine, type AuditEntry, type Engine } from './engine';
import { MemoryGrantStore, type GrantStore } from './grants';
import { createBudget, createRateLimiter, memoryLimitStore, type LimitStore } from './limits';
import { buildLock, diffLock, formatLockDiff, LOCKFILE_NAME, parseLock, serializeLock } from './lockfile';
import { mockPlanner, type Planner } from './planner';
import { seal, unseal } from './seal';
import type { RegistrationCredential, WebAuthnStepUp } from './webauthn';
import { isToolSource, type ToolEntry } from './sources';
import type { EngineOptions } from './engine';
import { configWarnings, defineConfig, mergeConfig, type SaydoConfig } from './config';
import type { TurnError, TurnResult } from './protocol';
import type { RouteRecord } from './route';
import type { SaydoUser } from './types';

export { GRANT_HEADER };

/**
 * Internal, flat form of the configuration. The public, grouped shape is `SaydoConfig`
 * (see ./config); `normalizeConfig` maps one onto the other.
 */
export interface HandlerOptions {
  /** Any AI SDK model. Omit in dev to use the deterministic mock planner. */
  /**
   * Any AI SDK model, or several in order of preference (failover on errors), or a function that
   * picks per request: `({ user, route }) => user.plan === 'pro' ? strongModel : fastModel`
   * (also how a tenant brings its own key: return a provider created with that key).
   */
  model?: LanguageModel | LanguageModel[] | ((context: { user: SaydoUser; route: string; request?: Request }) => LanguageModel | LanguageModel[]);
  /** Bring your own planner (custom agent, AG-UI backend). The gate still applies. */
  planner?: Planner;
  /**
   * Resolve the signed-in user (return null to refuse). Without it, each browser gets its own
   * signed anonymous identity, and production refuses actions that change data unless you set
   * `anonymous: true`.
   */
  getUser?: (request: Request) => SaydoUser | null | undefined | Promise<SaydoUser | null | undefined>;
  /**
   * Allow signed-out visitors to use actions that change data (a public feedback form, a demo).
   * Each browser gets its own isolated identity (a signed cookie), so visitors never share
   * approvals, conversations or limits. Default false in production.
   */
  anonymous?: boolean;
  /**
   * Where rate-limit and budget counters live. Default: in this process. With several
   * instances use `redisLimitStore(...)`, or limits multiply by the instance count.
   */
  limits?: LimitStore;
  /** Signs thread state. Defaults to SAYDO_SECRET, or a generated dev secret. */
  secret?: string;
  /** Durable grant store. `'memory'` opts into the in-process store (single-instance servers only). */
  store?: GrantStore | 'memory';
  appName?: string;
  /** Brand voice and domain hints, appended to the safety rules. A function picks them per request (`{ user, route }`). */
  instructions?: EngineOptions['instructions'];
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
  /**
   * Store conversations on the server: history, resume on any device, erasure. Optional;
   * without it the browser tab holds signed state. `firestoreThreadStore(db)`,
   * `postgresThreadStore(pool)`, `memoryThreadStore()`, or your own `ThreadStore`.
   */
  threads?: EngineOptions['threads'];
  /** Model prices per million tokens; usage entries then carry `costUsd`. */
  pricing?: EngineOptions['pricing'];
  /** OpenTelemetry tracer (`trace.getTracer('saydo')`): spans per model step and per action. */
  tracer?: EngineOptions['tracer'];
  /** Central policy for every action call (OPA, Cedar, your RBAC). It can deny or add confirmation, never remove it. */
  authorize?: EngineOptions['authorize'];
  /** Large apps: find actions by meaning with an embedder (`{ embed: (texts) => vectors }`). */
  search?: EngineOptions['search'];
  /** Record each request for debugging and regression tests (replay with `replayPlanner`). */
  record?: EngineOptions['record'];
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
  threadTtlMs?: number;
  taint?: EngineOptions['taint'];
  clarify?: boolean;
  knowledge?: EngineOptions['knowledge'];
  hide?: EngineOptions['hide'];
}

/** The public configuration (grouped). Kept under its old name too. */
export type SaydoOptions = SaydoConfig;
export { defineConfig, mergeConfig, type SaydoConfig };

/** Map the grouped, public configuration onto the flat options the handler and engine use. */
export function normalizeConfig(config: SaydoConfig): HandlerOptions {
  const day = 24 * 60 * 60_000;
  return {
    model: config.model,
    planner: config.advanced?.planner,
    getUser: typeof config.getUser === 'function' ? config.getUser : undefined,
    anonymous: config.getUser === 'anonymous',
    limits: config.limits?.store,
    secret: config.advanced?.secret,
    store: config.store,
    appName: config.knowledge?.name,
    instructions: config.instructions,
    rateLimit: config.limits?.perMinute,
    maxSteps: config.limits?.steps,
    audit: config.observe?.audit,
    capabilities: config.capabilities,
    tools: config.tools,
    see: config.see?.page === undefined ? undefined : { page: config.see.page },
    act: config.act
      ? { elements: config.act.elements, defaultRisk: config.act.defaultRisk, annotationsCanLowerRisk: config.act.annotationsCanLowerRisk }
      : undefined,
    maxTools: config.limits?.tools,
    redact: config.see?.redact,
    budget: config.limits?.perDay ? { requestsPerDay: config.limits.perDay.requests, tokensPerDay: config.limits.perDay.tokens } : undefined,
    onUsage: config.observe?.onUsage,
    threads: config.conversations?.store,
    threadTtlMs: config.conversations?.retentionDays !== undefined ? config.conversations.retentionDays * day : undefined,
    pricing: config.observe?.pricing,
    tracer: config.observe?.tracer,
    authorize: config.act?.authorize,
    search: config.advanced?.search,
    record: config.observe?.record,
    stepUp: config.act?.stepUp,
    confirmBudget: config.act?.confirmBudget,
    taint: config.act?.taint,
    clarify: config.act?.clarify,
    knowledge: config.knowledge,
    hide: config.hide,
    external: config.agents
      ? { approvals: config.agents.approvals, approvalUrl: config.agents.approvalUrl, authenticate: config.agents.authenticate, appOrigin: config.agents.appOrigin }
      : undefined,
    deploymentId: config.observe?.deploymentId,
    lockfile: config.advanced?.lockfile,
  };
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
  resolveUser: (request: Request) => Promise<{ user: SaydoUser | null; setCookie?: string }>;
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

export function createHandler(registry: Registry, overrides: SaydoConfig = {}): SaydoHandler {
  const config = mergeConfig(registry.config, overrides);
  for (const warning of configWarnings(config)) console.warn(`[saydo] ${warning}`);
  const options: HandlerOptions = normalizeConfig(config);
  const dev = process.env.NODE_ENV !== 'production';
  const counters = options.limits ?? memoryLimitStore();
  const limited = options.rateLimit === false ? async () => false : createRateLimiter(counters, options.rateLimit ?? 30);
  // Per instance on purpose: each instance stops calling a failing provider on its own evidence.
  const breaker = createCircuitBreaker();
  const budget = options.budget ? createBudget(counters, options.budget) : undefined;
  const staticTools = (options.tools ?? []).filter((t): t is Capability => !isToolSource(t));
  const sources = (options.tools ?? []).filter(isToolSource);
  const sourceNames = sources.map((s) => s.name);
  const allCapabilities = [...registry.capabilities, ...(options.capabilities ?? []), ...staticTools];
  let runtime: Promise<Runtime | { error: Omit<TurnError, 'ok'> }> | undefined;

  // Next evaluates route modules during `next build`: the moment to check the lockfile.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    syncLockfile(allCapabilities, registry.routes, options.lockfile, process.env.CI ? 'verify' : 'update', sourceNames);
  }

  /**
   * The user for this request. Without getUser, each browser gets its own signed visitor
   * identity, so anonymous visitors never share approvals, conversations or rate limits.
   */
  const resolveUser = async (request: Request, secret: string): Promise<{ user: SaydoUser | null; setCookie?: string }> => {
    if (options.getUser) return { user: (await options.getUser(request)) ?? null };
    const existing = readCookie(request, VISITOR_COOKIE);
    const known = existing ? await unseal<{ v: string; id: string }>(existing, secret) : null;
    if (known?.v === 'visitor' && typeof known.id === 'string') return { user: { id: known.id, anonymous: true } };
    const id = `visitor:${crypto.randomUUID()}`;
    const secure = new URL(request.url).protocol === 'https:';
    const token = await seal({ v: 'visitor', id }, secret);
    return {
      user: { id, anonymous: true },
      setCookie: `${VISITOR_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`,
    };
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
    if (!dev && !options.getUser && !options.anonymous && (options.threads || allCapabilities.some((c) => c.kind === 'server' && c.resolvedRisk !== 'read' && c.resolvedRisk !== 'never'))) {
      return {
        error: {
          status: 'error',
          message: 'No getUser is configured, so the assistant cannot tell users apart.',
          fix: "Set `getUser` in saydo.config.ts (your auth). For a public app without sign-in, set `getUser: 'anonymous'`: each browser then gets its own isolated identity.",
          code: 'no_user',
        },
      };
    }
    let store: GrantStore;
    if (options.store && options.store !== 'memory') store = options.store;
    else if (options.store === 'memory' || dev || !gated) {
      store = (g[STORE_KEY] ??= new MemoryGrantStore()) as GrantStore;
    } else {
      return {
        error: {
          status: 'error',
          message: 'No durable grant store is configured for gated capabilities.',
          fix: "Set `store` in saydo.config.ts (postgresGrantStore, redisGrantStore or firestoreGrantStore), or `store: 'memory'` for a single-instance server.",
        },
      };
    }
    if (!dev && (options.threads as { durable?: boolean } | undefined)?.durable === false) {
      console.warn('[saydo] memoryThreadStore() keeps conversations in this process only. Use firestoreThreadStore or postgresThreadStore with more than one instance.');
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
      threads: options.threads,
      threadTtlMs: options.threadTtlMs,
      taint: options.taint,
      clarify: options.clarify,
      knowledge: options.knowledge,
      hide: options.hide,
      authorize: options.authorize,
      search: options.search,
      record: options.record,
      deploymentId: options.deploymentId ?? process.env.VERCEL_DEPLOYMENT_ID ?? process.env.NEXT_DEPLOYMENT_ID,
      onUsage: (entry) => {
        budget?.countTokens(entry.userId, entry.inputTokens + entry.outputTokens).catch((error) => console.error('[saydo] budget store failed', error));
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
    const ready: Runtime = { engine, getUser: async (request) => (await resolveUser(request, secret)).user, resolveUser: (request) => resolveUser(request, secret), store, secret };
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
    // Enforced on the bytes read, not on the (optional, forgeable) content-length header.
    const text = await readCapped(request, 256_000);
    if (text === null) return problem(413, { status: 'invalid_args', message: 'Request too large.', fix: 'Send a shorter message.' });
    let body: { type?: string } & Record<string, unknown>;
    try {
      body = JSON.parse(text);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    } catch {
      return problem(400, { status: 'invalid_args', message: 'Expected a JSON body.', fix: 'Send JSON.' });
    }
    const ready = await init();
    if ('error' in ready) return problem(500, ready.error);

    const { user, setCookie } = await ready.resolveUser(request);
    if (!user) return problem(401, { status: 'forbidden', message: 'Sign in to use the assistant.', fix: 'Sign in.' });
    const response = await respond(ready, user, body, request, limitKeys(user, request));
    if (setCookie) response.headers.append('set-cookie', setCookie);
    return response;
  };

  /** Signed-out visitors are also limited per client IP, so dropping the cookie does not reset limits. */
  function limitKeys(user: SaydoUser, request: Request): string[] {
    if (options.getUser || user.anonymous !== true) return [user.id];
    const ip = clientIp(request);
    return ip ? [user.id, `ip:${ip}`] : [user.id];
  }

  async function respond(ready: Runtime, user: SaydoUser, body: { type?: string } & Record<string, unknown>, request: Request, keys: string[]): Promise<Response> {

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
    if ((await Promise.all(keys.map((key) => limited(key)))).some(Boolean)) {
      return problem(429, { status: 'error', message: 'Too many assistant requests.', fix: 'Wait a minute and try again.' });
    }
    if (typeof body.type === 'string' && body.type.startsWith('passkey-')) return passkeys(ready, user, body, request);
    if (body.type === 'grant-status') return json(await ready.engine.grantStatus(user, String(body.grantId ?? '')));
    if (body.type === 'threads' || body.type === 'thread-open' || body.type === 'thread-delete') {
      try {
        const { conversations } = ready.engine;
        if (body.type === 'threads') return json(await conversations.list(user, typeof body.limit === 'number' ? body.limit : undefined));
        if (body.type === 'thread-open') return json(await conversations.open(user, String(body.threadId ?? ''), (body.client ?? {}) as never));
        return json(await conversations.remove(user, String(body.threadId ?? '')));
      } catch (error) {
        console.error('[saydo] conversation store failed', error);
        return problem(503, { status: 'error', message: 'Conversation storage is unavailable right now.', fix: 'Try again in a moment.', code: 'store_unavailable' });
      }
    }
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
    if (budget && (await Promise.all(keys.map((key) => budget.exceeded(key)))).some(Boolean)) {
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
    if (budget) await Promise.all(keys.map((key) => budget.countRequest(key)));
    if (body.type === 'invoke') {
      // In-page browser agents (WebMCP): same policy; gated calls show the normal confirm card.
      return json(await ready.engine.invoke(user, { tool: String(body.tool ?? ''), args: body.args, origin: 'browser-agent', request }));
    }
    if (body.stream === true && (body.type === 'message' || body.type === 'approve' || body.type === 'receipt')) {
      // Newline-delimited JSON: {"type":"text","text":…} while the model writes, then one {"type":"result",…}.
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          let result: TurnResult;
          try {
            result = await ready.engine.handle(body as never, user, {
              request,
              onText: (text) => send({ type: 'text', text }),
              onStep: (text) => send({ type: 'step', text }),
            });
          } catch (error) {
            console.error('[saydo] request failed', error);
            result = { ok: false, status: 'error', message: 'The assistant failed to process this request.', fix: 'Try again.' };
          }
          breaker.record(!result.ok && result.code === 'planner_unavailable');
          send({ type: 'result', result });
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
      });
    }
    const result = await ready.engine.handle(body as never, user, { request });
    breaker.record(!result.ok && result.code === 'planner_unavailable');
    return json(result);
  };
  return Object.assign(POST, { [RUNTIME_INIT]: init, [HANDLER_OPTIONS]: options, [HANDLER_LIMITS]: { limited, budget } });
}

const VISITOR_COOKIE = 'saydo_visitor';

/** The client IP from a trusted source: saydo/node's socket address, else the platform proxy (Vercel, Cloudflare, Netlify). */
function clientIp(request: Request): string | undefined {
  const trusted = (globalThis as Record<symbol, WeakMap<Request, string> | undefined>)[Symbol.for('saydo.client-ip')]?.get(request);
  const h = request.headers;
  const ip = trusted || h.get('cf-connecting-ip') || h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip');
  return ip ? ip.slice(0, 64) : undefined;
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/** Read a request body, giving up (null) past `max` bytes. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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
