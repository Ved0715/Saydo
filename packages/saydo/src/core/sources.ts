import { asSchema, type Tool } from 'ai';
import { z } from 'zod';
import { defineCapability, type Capability, type CapabilityContext } from './capability';
import { CapabilityError } from './fixes';
import type { Risk } from './types';

/**
 * A lazily loaded set of capabilities: MCP servers, AI SDK tools, OpenAPI
 * specs, tRPC routers. Listed in `saydo.config.ts` under `tools`.
 */
export interface ToolSource {
  readonly kind: 'saydo-source';
  /** Shown in the lockfile, e.g. "mcp:stripe". */
  readonly name: string;
  load(): Promise<Capability[]>;
}

export type ToolEntry = Capability | ToolSource;

export function isToolSource(value: unknown): value is ToolSource {
  return !!value && typeof value === 'object' && (value as ToolSource).kind === 'saydo-source';
}

type RiskMap = Risk | Record<string, Risk>;

interface SourceOptions {
  /** Prefix for ids, e.g. "stripe" → "stripe.list_invoices". */
  prefix?: string;
  /** One risk for all, or per tool/operation name. Unmapped tools default to 'destructive'. */
  risk?: RiskMap;
  /** Only expose these names. */
  include?: string[];
  /** Hide these names. */
  exclude?: string[];
}

const ID_SAFE = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 't$1') || 'tool';

function riskFor(map: RiskMap | undefined, name: string, fallback: Risk = 'destructive'): Risk {
  const risk = typeof map === 'string' ? map : (map?.[name] ?? fallback);
  // External tools cannot ship an undo, so 'reversible' behaves like 'write'.
  return risk === 'reversible' ? 'write' : risk;
}

function selected(options: SourceOptions, name: string): boolean {
  if (options.include && !options.include.includes(name)) return false;
  return !options.exclude?.includes(name);
}

const passthrough = z.object({}).catchall(z.unknown());

interface JsonCapabilityInput {
  id: string;
  describe: string;
  title?: string;
  risk: Risk;
  jsonSchema: Record<string, unknown>;
  validate?: (value: unknown) => Promise<{ success: true; data: unknown } | { success: false; message: string }>;
  run: (input: Record<string, unknown>, ctx: CapabilityContext) => Promise<unknown>;
}

/** Build a capability described by a JSON Schema (for sources that are not Zod-typed). */
function jsonCapability(input: JsonCapabilityInput): Capability {
  return defineCapability({
    id: input.id,
    describe: input.describe.slice(0, 1000),
    title: input.title,
    input: passthrough,
    inputJsonSchema: input.jsonSchema.type === 'object' ? input.jsonSchema : { type: 'object', properties: {}, additionalProperties: true },
    validateInput: async (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { success: false, message: 'Expected an object.' };
      return input.validate ? input.validate(value) : { success: true, data: value };
    },
    risk: input.risk as Exclude<Risk, 'reversible'>,
    handler: async (args, ctx) => ({ result: await input.run(args as Record<string, unknown>, ctx) }),
  });
}

async function fromAiTool(id: string, name: string, tool: Tool, risk: Risk, describe?: string): Promise<Capability> {
  const schema = asSchema(tool.inputSchema as Parameters<typeof asSchema>[0]);
  const jsonSchema = (await schema.jsonSchema) as Record<string, unknown>;
  return jsonCapability({
    id,
    describe: describe ?? (typeof tool.description === 'string' ? tool.description : name),
    title: (tool as { title?: string }).title,
    risk,
    jsonSchema,
    validate: schema.validate
      ? async (value) => {
          const result = await schema.validate!(value);
          return result.success ? { success: true, data: result.value } : { success: false, message: String(result.error?.message ?? 'Invalid input').slice(0, 300) };
        }
      : undefined,
    run: async (args, ctx) => {
      if (!tool.execute) throw new CapabilityError('error', 'This tool has no server implementation.');
      const output = await tool.execute(args as never, { toolCallId: ctx.invocationId, messages: [], abortSignal: ctx.signal } as never);
      if (output && typeof output === 'object' && (output as { isError?: boolean }).isError) {
        throw new CapabilityError('error', 'The tool reported an error.');
      }
      return output;
    },
  });
}

/**
 * Expose AI SDK tools (anything made with `tool()` from 'ai') to the assistant.
 *
 *   tools: [aiTools({ weather, searchDocs }, { risk: { weather: 'read', searchDocs: 'read' } })]
 */
export function aiTools(toolset: Record<string, Tool>, options: SourceOptions = {}): ToolSource {
  return {
    kind: 'saydo-source',
    name: `tools:${options.prefix ?? Object.keys(toolset).join(',')}`.slice(0, 80),
    async load() {
      const out: Capability[] = [];
      for (const [name, tool] of Object.entries(toolset)) {
        if (!selected(options, name)) continue;
        const id = options.prefix ? `${options.prefix}.${ID_SAFE(name)}` : ID_SAFE(name);
        out.push(await fromAiTool(id, name, tool, riskFor(options.risk, name)));
      }
      return out;
    },
  };
}

export interface McpOptions extends SourceOptions {
  url?: string;
  headers?: Record<string, string>;
  /** 'http' (default) or 'sse'. */
  transport?: 'http' | 'sse' | object;
  /**
   * Let the server's own annotations set risk for unmapped tools (readOnlyHint → read,
   * destructiveHint:false → write). Off by default: hints from another server are not
   * proof. Your call.
   */
  trustAnnotations?: boolean;
}

/**
 * Connect an MCP server; its tools become actions.
 *
 *   tools: [mcp({ url: 'https://mcp.example.com/mcp', prefix: 'crm', risk: { search: 'read' } })]
 */
export function mcp(options: McpOptions): ToolSource {
  return {
    kind: 'saydo-source',
    name: `mcp:${options.prefix ?? options.url ?? 'custom'}`,
    async load() {
      // Optional peer: loaded at runtime only when mcp() is used, invisible to bundlers.
      const specifier = '@ai-sdk/mcp';
      let createMCPClient: typeof import('@ai-sdk/mcp').createMCPClient;
      try {
        ({ createMCPClient } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ specifier)) as typeof import('@ai-sdk/mcp'));
      } catch {
        throw new Error('[saydo] mcp() needs the @ai-sdk/mcp package (fix: npm install @ai-sdk/mcp).');
      }
      const transport =
        typeof options.transport === 'object'
          ? options.transport
          : { type: options.transport ?? 'http', url: options.url ?? '', headers: options.headers };
      const client = await createMCPClient({ transport: transport as never });
      const listed = await client.listTools();
      const annotations = new Map(listed.tools.map((t) => [t.name, (t as { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }).annotations]));
      const toolset = (await client.tools()) as Record<string, Tool>;
      const out: Capability[] = [];
      for (const [name, tool] of Object.entries(toolset)) {
        if (!selected(options, name)) continue;
        let fallback: Risk = 'destructive';
        const hints = annotations.get(name);
        if (options.trustAnnotations && hints) fallback = hints.readOnlyHint ? 'read' : hints.destructiveHint === false ? 'write' : 'destructive';
        const id = options.prefix ? `${options.prefix}.${ID_SAFE(name)}` : ID_SAFE(name);
        out.push(await fromAiTool(id, name, tool, riskFor(options.risk, name, fallback)));
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- OpenAPI

type Json = Record<string, unknown>;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function pointer(root: Json, ref: string): unknown {
  return ref
    .replace(/^#\//, '')
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Json)[key] : undefined), root);
}

/** Inline local $refs so the model sees a self-contained schema. */
function deref(schema: unknown, root: Json, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 12) return depth > 12 ? {} : schema;
  if (Array.isArray(schema)) return schema.map((s) => deref(s, root, depth + 1));
  const node = schema as Json;
  if (typeof node.$ref === 'string') return deref(pointer(root, node.$ref), root, depth + 1);
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(v, root, depth + 1)]));
}

export interface OpenAPIOptions extends SourceOptions {
  /** Base URL of the API. Default: the spec's first server, resolved against the request origin. */
  baseUrl?: string;
  /** Risk per HTTP method for unmapped operations, e.g. { GET: 'read' }. */
  methods?: Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Risk>>;
  /** Extra headers per call (auth tokens). */
  headers?: (ctx: CapabilityContext) => Record<string, string> | Promise<Record<string, string>>;
  /** Forward the user's cookies (same-origin APIs). Default false. */
  forwardCookies?: boolean;
  fetch?: typeof fetch;
}

async function loadSpec(spec: Json | string | URL): Promise<Json> {
  if (typeof spec === 'object' && !(spec instanceof URL)) return spec;
  const location = String(spec);
  if (/^https?:\/\//.test(location)) {
    const response = await fetch(location);
    if (!response.ok) throw new Error(`[saydo] Could not load OpenAPI spec ${location} (HTTP ${response.status}).`);
    return (await response.json()) as Json;
  }
  const proc = globalThis.process as (NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }) | undefined;
  const fs = proc?.getBuiltinModule?.('node:fs') as typeof import('node:fs') | undefined;
  if (!fs) throw new Error('[saydo] Reading an OpenAPI file needs Node.js (fix: pass the spec object instead).');
  const text = fs.readFileSync(location, 'utf8');
  try {
    return JSON.parse(text) as Json;
  } catch {
    throw new Error(`[saydo] ${location} is not JSON (fix: convert YAML specs to JSON, or pass the parsed object).`);
  }
}

/**
 * Expose REST operations from an OpenAPI 3 spec. Every operation is opt-in via
 * `include` (by operationId) or exposed wholesale if you leave it out.
 *
 *   tools: [fromOpenAPI('./openapi.json', { include: ['listInvoices', 'refundInvoice'], methods: { GET: 'read' } })]
 */
export function fromOpenAPI(spec: Json | string | URL, options: OpenAPIOptions = {}): ToolSource {
  return {
    kind: 'saydo-source',
    name: `openapi:${options.prefix ?? (typeof spec === 'string' ? spec : 'spec')}`,
    async load() {
      const doc = await loadSpec(spec);
      const out: Capability[] = [];
      const paths = (doc.paths ?? {}) as Record<string, Json>;
      for (const [route, item] of Object.entries(paths)) {
        for (const method of METHODS) {
          const op = item[method] as Json | undefined;
          if (!op) continue;
          const operationId = String(op.operationId ?? `${method}_${route}`);
          if (!selected(options, operationId)) continue;
          const params = [...((item.parameters as Json[]) ?? []), ...((op.parameters as Json[]) ?? [])].map((p) => deref(p, doc) as Json);
          const properties: Json = {};
          const required: string[] = [];
          const pathParams: string[] = [];
          const queryParams: string[] = [];
          for (const param of params) {
            if (param.in !== 'path' && param.in !== 'query') continue;
            const name = String(param.name);
            properties[name] = { ...((deref(param.schema, doc) as Json) ?? { type: 'string' }), description: param.description };
            if (param.required || param.in === 'path') required.push(name);
            (param.in === 'path' ? pathParams : queryParams).push(name);
          }
          const body = deref((op.requestBody as Json | undefined), doc) as Json | undefined;
          const bodySchema = (body?.content as Record<string, Json> | undefined)?.['application/json']?.schema;
          if (bodySchema) {
            properties.body = deref(bodySchema, doc);
            if (body?.required) required.push('body');
          }
          const upper = method.toUpperCase() as keyof NonNullable<OpenAPIOptions['methods']>;
          const risk = riskFor(options.risk, operationId, options.methods?.[upper] ?? 'destructive');
          const servers = (doc.servers as Array<{ url?: string }> | undefined) ?? [];
          out.push(
            jsonCapability({
              id: `${options.prefix ? `${options.prefix}.` : ''}${ID_SAFE(operationId)}`,
              describe: String(op.summary ?? op.description ?? `${upper} ${route}`),
              risk,
              jsonSchema: { type: 'object', properties, required, additionalProperties: false },
              run: async (args, ctx) => {
                const base = options.baseUrl ?? servers[0]?.url ?? '';
                const origin = ctx.request ? new URL(ctx.request.url).origin : 'http://localhost';
                let path = route;
                for (const name of pathParams) path = path.replace(`{${name}}`, encodeURIComponent(String(args[name] ?? '')));
                const url = new URL(`${base.replace(/\/$/, '')}${path}`, origin);
                for (const name of queryParams) if (args[name] !== undefined) url.searchParams.set(name, String(args[name]));
                const headers: Record<string, string> = { accept: 'application/json', ...(await options.headers?.(ctx)) };
                if (options.forwardCookies && ctx.request?.headers.get('cookie')) headers.cookie = ctx.request.headers.get('cookie')!;
                if (args.body !== undefined) headers['content-type'] = 'application/json';
                const response = await (options.fetch ?? fetch)(url, {
                  method: upper,
                  headers,
                  body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
                  signal: ctx.signal,
                });
                if (!response.ok) {
                  const status = response.status === 404 ? 'not_found' : response.status === 401 || response.status === 403 ? 'forbidden' : 'error';
                  // Never pass the response body through: it could carry injected instructions.
                  throw new CapabilityError(status, `The API returned HTTP ${response.status}.`, `http_${response.status}`);
                }
                const type = response.headers.get('content-type') ?? '';
                return type.includes('json') ? response.json() : (await response.text()).slice(0, 4000);
              },
            }),
          );
        }
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- tRPC

interface TRPCProcedureLike {
  _def: { type?: string; inputs?: unknown[]; meta?: { description?: string; risk?: Risk } };
}
/** Any tRPC v10/v11 router. Its `_def.procedures` is a flat record keyed by dotted path at runtime. */
interface TRPCRouterLike {
  _def: { procedures: object };
}

export interface TRPCOptions extends SourceOptions {
  /** Your server-side caller, e.g. (ctx) => createCaller(await createContext({ req: ctx.request })). */
  caller: (ctx: CapabilityContext) => unknown | Promise<unknown>;
  /** Queries default to this risk (mutations stay 'destructive' unless mapped). */
  queries?: Risk;
}

/**
 * Expose tRPC procedures. Input schemas come from the procedures' Zod `.input()`,
 * descriptions from `.meta({ description })`.
 *
 *   tools: [fromTRPC(appRouter, { caller: (ctx) => createCaller({ user: ctx.user }), queries: 'read' })]
 */
export function fromTRPC(router: TRPCRouterLike, options: TRPCOptions): ToolSource {
  return {
    kind: 'saydo-source',
    name: `trpc:${options.prefix ?? 'router'}`,
    async load() {
      const out: Capability[] = [];
      for (const [path, procedure] of Object.entries(router._def.procedures as Record<string, TRPCProcedureLike>)) {
        const def = procedure._def;
        if (def.type === 'subscription' || !selected(options, path)) continue;
        const parser = def.inputs?.[0];
        const jsonSchema =
          parser instanceof z.ZodType
            ? (z.toJSONSchema(parser, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>)
            : { type: 'object', properties: {}, additionalProperties: true };
        const fallback = def.meta?.risk ?? (def.type === 'query' ? (options.queries ?? 'destructive') : 'destructive');
        out.push(
          jsonCapability({
            id: `${options.prefix ? `${options.prefix}.` : ''}${path}`,
            describe: def.meta?.description ?? `${def.type ?? 'procedure'} ${path}`,
            risk: riskFor(options.risk, path, fallback),
            jsonSchema,
            validate:
              parser instanceof z.ZodType
                ? async (value) => {
                    const result = parser.safeParse(value);
                    return result.success ? { success: true, data: result.data } : { success: false, message: result.error.issues[0]?.message ?? 'Invalid input' };
                  }
                : undefined,
            run: async (args, ctx) => {
              const caller = (await options.caller(ctx)) as Record<string, unknown>;
              const fn = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], caller);
              if (typeof fn !== 'function') throw new CapabilityError('error', `Procedure ${path} is not callable.`);
              return (fn as (input: unknown) => Promise<unknown>)(parser ? args : undefined);
            },
          }),
        );
      }
      return out;
    },
  };
}
