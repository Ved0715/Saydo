import type { UIActionDescriptor } from '../core/index';

export interface ActionContext {
  signal: AbortSignal;
  /** Attach these to your API call; `withGrant` verifies the grant header. */
  headers: Record<string, string>;
  /** `fetch` with `headers` already attached. */
  fetch: typeof fetch;
  grant?: string;
  invocationId: string;
}

export interface RegisteredAction {
  id: string;
  kind: 'ui' | 'capability';
  describe?: string;
  inputSchema?: Record<string, unknown>;
  /** Exact phrases that run this action instantly in the browser, with no model call. */
  phrases?: string[];
  run: (args: unknown, ctx: ActionContext) => unknown;
}

export const normalizePhrase = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^please /, '')
    .replace(/ please$/, '');

const isDev = () => typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';

/**
 * External store of what is mounted right now. Components register in effects
 * (never during render), so concurrent rendering cannot tear it and hidden
 * <Activity> trees, whose effects are cleaned up, leave no ghost actions.
 */
export class Registry {
  private readonly entries = new Map<string, Map<symbol, RegisteredAction>>();
  private readonly contexts = new Map<string, unknown>();
  private readonly guards = new Map<symbol, string>();
  private readonly listeners = new Set<() => void>();
  private readonly warned = new Set<string>();
  private version = 0;

  register(owner: symbol, action: RegisteredAction): () => void {
    let owners = this.entries.get(action.id);
    if (!owners) {
      owners = new Map();
      this.entries.set(action.id, owners);
    }
    owners.set(owner, action);
    if (owners.size > 1 && isDev() && !this.warned.has(action.id)) {
      this.warned.add(action.id);
      console.warn(
        `[saydo] "${action.id}" is mounted ${owners.size} times. Register it once (for example at the list level) and pass the target as input.`,
      );
    }
    this.emit();
    return () => {
      const current = this.entries.get(action.id);
      current?.delete(owner);
      if (current && !current.size) this.entries.delete(action.id);
      this.emit();
    };
  }

  /** A mounted UI action whose phrases match this text exactly (case and punctuation ignored). */
  byPhrase(text: string): RegisteredAction | undefined {
    const normal = normalizePhrase(text);
    if (!normal) return undefined;
    for (const id of this.ids()) {
      const action = this.get(id);
      if (action?.kind === 'ui' && action.phrases?.some((p) => normalizePhrase(p) === normal)) return action;
    }
    return undefined;
  }

  get(id: string): RegisteredAction | undefined {
    const owners = this.entries.get(id);
    if (!owners) return undefined;
    return [...owners.values()].at(-1);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  uiDescriptors(): UIActionDescriptor[] {
    return this.ids()
      .map((id) => this.get(id)!)
      .filter((a) => a.kind === 'ui')
      .map((a) => ({ id: a.id, describe: a.describe ?? a.id, inputSchema: a.inputSchema }));
  }

  /** Unsaved-changes guards (useSaydoGuard). */
  setGuard(owner: symbol, message: string | null) {
    if (message) this.guards.set(owner, message);
    else this.guards.delete(owner);
  }

  activeGuard(): string | undefined {
    return [...this.guards.values()][0];
  }

  setContext(key: string, value: unknown) {
    this.contexts.set(key, value);
  }

  removeContext(key: string) {
    this.contexts.delete(key);
  }

  contextSnapshot(): Record<string, unknown> | undefined {
    if (!this.contexts.size) return undefined;
    return Object.fromEntries(this.contexts);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  /** Resolve once `id` is mounted, or false after the timeout. */
  waitFor(id: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (this.entries.has(id)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (value: boolean) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      const unsubscribe = this.subscribe(() => {
        if (this.entries.has(id)) done(true);
      });
      const timer = setTimeout(() => done(false), timeoutMs);
      signal?.addEventListener('abort', () => done(false), { once: true });
    });
  }

  private emit() {
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }
}
