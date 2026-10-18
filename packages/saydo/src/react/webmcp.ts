'use client';
import type { AgentTool, InvokeResult } from '../core/index';
import type { SaydoRuntime } from './runtime';

interface ModelContext {
  registerTool(tool: Record<string, unknown>, options?: { signal?: AbortSignal }): unknown;
}

// One registration per tool per model context, even with a polyfill next to the native API.
const registered = new WeakMap<object, Set<string>>();

/** The WebMCP entry point if the browser has one (document first, navigator as the older location). */
export function modelContext(): ModelContext | undefined {
  if (typeof document === 'undefined') return undefined;
  const candidate =
    (document as unknown as { modelContext?: ModelContext }).modelContext ?? (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  return candidate && typeof candidate.registerTool === 'function' ? candidate : undefined;
}

function format(result: InvokeResult | null) {
  if (!result) return { content: [{ type: 'text', text: 'The app could not be reached.' }], isError: true };
  if (!result.ok) return { content: [{ type: 'text', text: `${result.message} ${result.fix}` }], isError: true };
  if (result.status === 'needs_approval') return { content: [{ type: 'text', text: 'Waiting for the user to approve.' }] };
  const { receipt } = result;
  return {
    content: [{ type: 'text', text: JSON.stringify({ status: receipt.status, message: receipt.message, result: receipt.result }).slice(0, 1500) }],
    isError: receipt.status !== 'ok',
  };
}

/** Register the actions you exposed with `expose: { browserAgent: true }`. Returns the cleanup. */
export function registerWebMcpTools(runtime: SaydoRuntime, tools: AgentTool[]): () => void {
  const context = modelContext();
  if (!context || !tools.length) return () => {};
  const controller = new AbortController();
  const names = registered.get(context) ?? new Set<string>();
  registered.set(context, names);
  for (const tool of tools) {
    if (names.has(tool.name)) continue;
    names.add(tool.name);
    const failed = (error: unknown) => {
      names.delete(tool.name);
      const blocked = (error as { name?: string })?.name === 'NotAllowedError';
      console.warn(
        blocked
          ? `[saydo] The page's Permissions-Policy blocks WebMCP, so "${tool.name}" was not registered (fix: pass agents: true to withSaydo() or the Vite plugin).`
          : `[saydo] Could not register WebMCP tool ${tool.name}`,
        error,
      );
    };
    try {
      const registration = context.registerTool(
        {
          name: tool.name,
          title: tool.title,
          description: tool.description.slice(0, 500),
          inputSchema: tool.inputSchema,
          annotations: {
            readOnlyHint: tool.annotations.readOnlyHint,
            consequentialHint: tool.risk === 'write' || tool.risk === 'destructive',
          },
          execute: async (input: unknown) => format(await runtime.invokeAgent(tool.name, input ?? {})),
        },
        { signal: controller.signal },
      );
      // The spec's registerTool returns a promise that rejects when the policy disallows it.
      if (registration && typeof (registration as Promise<unknown>).then === 'function') (registration as Promise<unknown>).catch(failed);
      controller.signal.addEventListener('abort', () => names.delete(tool.name), { once: true });
    } catch (error) {
      failed(error);
    }
  }
  return () => controller.abort();
}
