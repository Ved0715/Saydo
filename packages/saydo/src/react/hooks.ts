'use client';
import { useEffect, useInsertionEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { CapabilityError, type Capability } from '../core/index';
import { useRegistry, useRuntime } from './context';
import type { ActionContext } from './registry';

/** Always calls the latest render's function; safe to hand to the registry and call later. */
export function useLatest<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  useInsertionEffect(() => {
    ref.current = fn;
  });
  return useMemo(() => ((...args: Parameters<T>) => ref.current(...args)) as T, []);
}

function jsonSchemaOf(schema: z.ZodObject | undefined): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>;
  return rest;
}

export interface UseActionOptions<S extends z.ZodObject> {
  /** Arguments the assistant may pass. Validated before your handler runs. */
  input?: S;
  /** Register only while true (e.g. when a button would be enabled). */
  enabled?: boolean;
}

/**
 * Expose one UI change to the assistant: open a dialog, switch a tab, toggle a
 * theme. UI actions are tier 0 by construction, so they must not mutate server
 * state; use defineCapability for that.
 *
 *   useAction('share.open', 'Open the share dialog for this post', () => setOpen(true));
 */
export function useAction<S extends z.ZodObject = z.ZodObject>(
  id: string,
  describe: string,
  handler: (input: z.output<S>, ctx: ActionContext) => unknown,
  options: UseActionOptions<S> = {},
) {
  const registry = useRegistry();
  const run = useLatest(handler);
  const { input, enabled = true } = options;
  const inputSchema = useMemo(() => jsonSchemaOf(input), [input]);
  useEffect(() => {
    if (!enabled) return;
    return registry.register(Symbol(id), {
      id,
      kind: 'ui',
      describe,
      inputSchema,
      run: (args, ctx) => {
        let value = args;
        if (input) {
          const parsed = input.safeParse(args ?? {});
          if (!parsed.success) {
            throw new CapabilityError('invalid_args', parsed.error.issues.map((i) => i.message).join('; ').slice(0, 200));
          }
          value = parsed.data;
        }
        return run(value as z.output<S>, ctx);
      },
    });
  }, [registry, id, describe, inputSchema, input, enabled]);
}

/**
 * Implement a declared client capability (one without a server `handler`) in
 * a component, typically to reuse an existing client mutation. Gated calls
 * arrive with `ctx.headers` carrying the grant; send them to a route wrapped
 * in `withGrant`, or simply use `ctx.fetch`.
 */
export function useCapability<S extends z.ZodObject>(
  capability: Capability<S>,
  handler: (input: z.output<S>, ctx: ActionContext) => unknown,
  options: { enabled?: boolean } = {},
) {
  const registry = useRegistry();
  const run = useLatest(handler);
  const enabled = options.enabled ?? true;
  if (!capability.id) {
    throw new Error(
      `useCapability: client capabilities need an explicit id (fix: add \`id: '...'\` to "${capability.describe}").`,
    );
  }
  if (capability.kind === 'server') {
    throw new Error(
      `useCapability("${capability.id}"): this capability already has a server handler (fix: remove the handler or use useAction).`,
    );
  }
  useEffect(() => {
    if (!enabled) return;
    return registry.register(Symbol(capability.id), {
      id: capability.id,
      kind: 'capability',
      describe: capability.describe,
      run: (args, ctx) => run(args as z.output<S>, ctx),
    });
  }, [registry, capability.id, capability.describe, enabled]);
}

/**
 * Block AI navigation while the page has unsaved changes. The assistant is told
 * the page is dirty, and navigation requests return `blocked: unsaved_changes`.
 *
 *   useSaydoGuard(form.formState.isDirty)
 */
export function useSaydoGuard(active: boolean, message = 'This page has unsaved changes.') {
  const registry = useRegistry();
  useEffect(() => {
    if (!active) return;
    const owner = Symbol('guard');
    registry.setGuard(owner, message);
    return () => registry.setGuard(owner, null);
  }, [registry, active, message]);
}

/**
 * Share a small piece of page state with the assistant (sent each turn,
 * treated as untrusted data). Opt in field by field; never pass whole records.
 */
export function useSaydoContext(key: string, value: unknown) {
  const registry = useRegistry();
  const serialized = useMemo(() => {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }, [value]);
  useEffect(() => {
    if (serialized === undefined) return;
    registry.setContext(key, JSON.parse(serialized));
    return () => registry.removeContext(key);
  }, [registry, key, serialized]);
}

/** Read assistant state and drive it from your own UI. */
export function useSaydo() {
  const runtime = useRuntime();
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  return useMemo(
    () => ({
      ...snapshot,
      open: snapshot.open,
      setOpen: (open: boolean) => runtime.setOpen(open),
      send: (text: string) => runtime.send(text),
      approve: (trusted: boolean, typed?: string) => runtime.approve(trusted, typed),
      deny: () => runtime.deny(),
      undo: (token: string) => runtime.undo(token),
      goTo: (href: string, title?: string) => runtime.goTo(href, title),
      reset: () => runtime.reset(),
      dismissToast: (id: string) => runtime.dismissToast(id),
    }),
    [runtime, snapshot],
  );
}
