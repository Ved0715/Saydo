import { z } from 'zod';
import type { SaydoUser, ConfirmView, Effect, Exposure, Risk } from './types';

const CAPABILITY_BRAND = Symbol.for('saydo.capability');
const SERVER_ACTION = Symbol.for('saydo.server-action');

export interface CapabilityContext<U extends SaydoUser = SaydoUser> {
  user: U;
  signal: AbortSignal;
  /** Unique per invocation; also the idempotency key. */
  invocationId: string;
  threadId: string;
  /** The route the user was on when the turn started. */
  route: string;
  /** The incoming HTTP request (cookies, headers), when available. */
  request?: Request;
}

/** What a handler may return. Anything else is treated as `{ result }`. */
export interface HandlerResult {
  result?: unknown;
  effects?: Effect[];
}

type Handler<I> = (input: I, ctx: CapabilityContext) => unknown | Promise<unknown>;

interface CapabilityCommon<S extends z.ZodObject> {
  /**
   * Namespaced id, e.g. 'posts.create'. Optional for a file's default export:
   * `capabilities/posts/create.ts` becomes 'posts.create'. Capabilities are
   * singletons: target records go in `input`.
   */
  id?: string;
  /** What it does, for the model. Be specific; overlapping descriptions cause misfires. */
  describe: string;
  input: S;
  /** Short human title for receipts and confirm cards. Defaults to `describe`. */
  title?: string;
  version?: number;
  /**
   * How many records this call affects, for inputs that select by filter rather than by listing
   * records (`{ status: 'draft' }`). Destructive calls above the bulk threshold then need step-up,
   * and the card shows the count. An error counts as unlimited. Inputs that list records
   * (arrays of `Post.ref()`) are counted automatically.
   */
  blastRadius?: (input: z.output<S>, ctx: { user: SaydoUser }) => number | Promise<number>;
  /**
   * The results contain text other people wrote (comments, emails, web pages). They reach the
   * model marked as untrusted, and later steps in the same request need the user's click even
   * when they would normally run directly. Imported tools (MCP, OpenAPI, AI SDK) set this.
   */
  untrustedResults?: boolean;
  /** Always require step-up (passkey, or typed text without one) to approve this action. */
  stepUp?: boolean;
  /** Server-side permission check. Capabilities failing it are never offered. */
  can?: (user: SaydoUser) => boolean | Promise<boolean>;
  /** Override the generated confirm card. It receives validated, resolved input. */
  confirm?: { view?: (input: z.output<S>) => ConfirmView };
  /** Relevance hint for server capabilities; required mount route for client ones. */
  scope?: { routes?: string[] };
  /** Client capabilities only: route to open before dispatching, so it can mount. */
  entry?: string;
  expose?: Exposure;
  /** Advanced: a JSON Schema to show the model instead of `input` (used by MCP, AI SDK tool and OpenAPI sources). */
  inputJsonSchema?: Record<string, unknown>;
  /** Advanced: custom validation instead of `input.safeParse` (used with `inputJsonSchema`). */
  validateInput?: (value: unknown) => { success: true; data: unknown } | { success: false; message: string } | Promise<{ success: true; data: unknown } | { success: false; message: string }>;
}

/**
 * The type system enforces the safety claims: `reversible` must ship an `undo`.
 * A capability without `handler` is a client capability, implemented with
 * `useCapability` in a component.
 */
export type CapabilityDefinition<S extends z.ZodObject> = CapabilityCommon<S> &
  (
    | { risk: 'reversible'; handler: Handler<z.output<S>>; undo: Handler<z.output<S>> }
    | { risk?: Exclude<Risk, 'reversible'>; handler?: Handler<z.output<S>>; undo?: never }
  );

// `any` default: handlers are contravariant in their input, so heterogeneous lists need it.
export type Capability<S extends z.ZodObject = any> = CapabilityDefinition<S> & {
  /** Empty until assigned from the file path when the definition omitted it. */
  readonly id: string;
  readonly [CAPABILITY_BRAND]: true;
  readonly kind: 'server' | 'client';
  readonly resolvedRisk: Risk;
  /** Workflows: the step titles, shown on the confirm card. */
  readonly steps?: readonly string[];
};

const ID_PATTERN = /^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/i;

export function defineCapability<S extends z.ZodObject>(
  definition: CapabilityDefinition<S>,
): Capability<S> {
  if (definition.id !== undefined) assertId(definition.id);
  if (!(definition.input instanceof z.ZodObject)) {
    throw new Error(
      `defineCapability("${definition.id ?? definition.describe}"): input must be a z.object(...) (fix: wrap fields in z.object).`,
    );
  }
  // The type already requires `undo`; this guards plain-JS callers.
  const { id, risk, undo } = definition as { id: string; risk?: Risk; undo?: unknown };
  if (risk === 'reversible' && typeof undo !== 'function') {
    throw new Error(
      `defineCapability("${id}"): risk 'reversible' requires an undo function (fix: add \`undo\` or use risk 'write').`,
    );
  }
  return {
    ...definition,
    id: definition.id ?? '',
    [CAPABILITY_BRAND]: true,
    kind: typeof definition.handler === 'function' ? 'server' : 'client',
    // Unspecified risk fails safe, matching MCP's destructiveHint default.
    resolvedRisk: definition.risk ?? 'destructive',
  } as Capability<S>;
}

function assertId(id: string) {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Capability id "${id}" is invalid (fix: use dotted names like "posts.create").`);
  }
}

/** A Server Action your UI calls directly, that the assistant can call too. */
export type ServerAction<S extends z.ZodObject, R> = ((input: z.input<S> | FormData) => Promise<R>) & {
  readonly [SERVER_ACTION]: Capability<S>;
};

function formDataToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith('$ACTION')) continue; // Next.js internals
    const v = typeof value === 'string' ? value : value.name;
    if (key in out) out[key] = ([] as unknown[]).concat(out[key], v);
    else out[key] = v;
  }
  return out;
}

/**
 * One function for humans and the assistant. Put it in a 'use server' file:
 *
 *   'use server';
 *   export const renamePost = serverAction(
 *     { describe: 'Rename a post', input: z.object({ post: Post.ref({ as: 'id' }), title: z.string() }), risk: 'write' },
 *     async ({ post, title }) => { ... },
 *   );
 *
 * Your UI calls it like any Server Action (with an object or a <form>'s
 * FormData; both are validated by `input`). The assistant gets it as an action
 * with the same validation, plus consent per `risk`. The id defaults to the
 * export name. Do your own authorization inside, as with any Server Action.
 */
export function serverAction<S extends z.ZodObject, R>(
  definition: Omit<CapabilityCommon<S>, 'entry'> &
    (
      | { risk: 'reversible'; undo: (input: z.output<S>, ctx: CapabilityContext) => unknown }
      | { risk?: Exclude<Risk, 'reversible'>; undo?: never }
    ),
  fn: (input: z.output<S>, ctx?: CapabilityContext) => Promise<R> | R,
): ServerAction<S, R> {
  const capability = defineCapability({ ...definition, handler: (input, ctx) => fn(input, ctx) } as CapabilityDefinition<S>);
  const action = async (input: z.input<S> | FormData): Promise<R> => {
    const raw = typeof FormData !== 'undefined' && input instanceof FormData ? formDataToObject(input) : input;
    return fn(definition.input.parse(raw) as z.output<S>);
  };
  return Object.assign(action, { [SERVER_ACTION]: capability }) as ServerAction<S, R>;
}

export function isServerAction(value: unknown): value is ServerAction<z.ZodObject, unknown> {
  return typeof value === 'function' && SERVER_ACTION in value;
}

/** Convert a path inside capabilities/ to an id: 'posts/create.ts' → 'posts.create'. */
export function idFromPath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/\.(tsx|ts|jsx|js|mjs)$/, '')
    .replace(/(^|\/)index$/, '')
    .split('/')
    .filter(Boolean)
    .join('.');
}

/**
 * Used by the generated registry: give a module's id-less default export the
 * id derived from its file path. Named exports must declare their own id.
 */
export function withFileId<T extends Record<string, unknown>>(moduleNamespace: T, id: string): T {
  const out: Record<string, unknown> = { ...moduleNamespace };
  for (const [key, value] of Object.entries(moduleNamespace)) {
    if (isServerAction(value)) {
      // Server Actions: id defaults to the export name.
      const cap = value[SERVER_ACTION];
      out[key] = cap.id ? cap : { ...cap, id: key === 'default' ? id : key };
    } else if (key === 'default' && isCapability(value) && !value.id) {
      assertId(id);
      out[key] = { ...value, id };
    }
  }
  return out as T;
}

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'object' && value !== null && CAPABILITY_BRAND in value;
}

/** Collect capabilities from module namespaces (`import * as mod`), arrays, or single values. */
export function collectCapabilities(...sources: unknown[]): Capability[] {
  const found = new Map<string, Capability>();
  const visit = (value: unknown) => {
    if (isServerAction(value)) {
      visit(value[SERVER_ACTION]);
    } else if (isCapability(value)) {
      if (!value.id) {
        throw new Error(
          `A capability ("${value.describe}") has no id (fix: make it the default export of a file in capabilities/, or pass \`id\`).`,
        );
      }
      const existing = found.get(value.id);
      if (existing && existing !== value) {
        throw new Error(
          `Two capabilities share the id "${value.id}" (fix: ids must be unique; pass the target record as input instead of registering per item).`,
        );
      }
      found.set(value.id, value);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object' && !(value instanceof z.ZodType)) {
      Object.values(value).forEach((v) => {
        if (isCapability(v) || isServerAction(v) || Array.isArray(v)) visit(v);
      });
    }
  };
  sources.forEach(visit);
  return [...found.values()];
}

// Declarative effect helpers for handler return values.
export const navigate = (href: string, options: { replace?: boolean } = {}): Effect => ({
  type: 'navigate',
  href,
  ...options,
});
export const refresh = (): Effect => ({ type: 'refresh' });
/** Ask the browser to refetch these client-cache keys (wire them with `onInvalidate` on the provider). */
export const invalidate = (...keys: string[]): Effect => ({ type: 'invalidate', keys });
export const toast = (message: string): Effect => ({ type: 'toast', message });
