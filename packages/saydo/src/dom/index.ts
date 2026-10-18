import { searchRoutes, type StepUpChallenge } from '../core/index';
import { Registry, type ActionContext } from '../react/registry';
import { SaydoRuntime, type ConfirmPending, type RouterAdapter, type RuntimeSnapshot } from '../react/runtime';
import { defaultMessages, type SaydoMessages } from '../react/strings';
import { STYLES } from '../react/styles';
import { registerWebMcpTools } from '../react/webmcp';

export interface CreateSaydoOptions {
  /** Route handler path. Default '/api/saydo'. */
  endpoint?: string;
  /**
   * How to navigate. Default: full page loads (`location.assign`). Single-page apps pass
   * their router and call `saydo.navigated()` after each route change.
   */
  router?: RouterAdapter;
  /** Render the default palette, conversation, confirm card and undo toasts. Default true. */
  ui?: boolean;
  /** Where the UI mounts. Default document.body. */
  root?: HTMLElement;
  /** Toggle the palette with Cmd/Ctrl+K. Default true. */
  hotkey?: boolean;
  placeholder?: string;
  messages?: Partial<SaydoMessages>;
  /** Custom step-up proof (default: WebAuthn passkey). */
  stepUp?: (challenge: StepUpChallenge) => Promise<unknown>;
  /** Expose `expose: { browserAgent: true }` actions to in-page browser agents (WebMCP). Default false. */
  agents?: boolean;
  fetch?: typeof fetch;
  /** Refetch client caches after AI writes (keys from `invalidate(...)`, or undefined after any write). */
  onInvalidate?: (keys?: string[]) => void;
}

export interface SaydoClient {
  readonly runtime: SaydoRuntime;
  /** Send a request as if the user typed it. */
  ask(text: string): Promise<void>;
  open(): void;
  close(): void;
  /** A UI action the assistant can run while it is registered (like `useAction`). Returns the unregister function. */
  action(id: string, describe: string, run: (args: unknown, ctx: ActionContext) => unknown, options?: { input?: Record<string, unknown> }): () => void;
  /** Implement a client capability declared with `defineCapability` (like `useCapability`). */
  capability(id: string, run: (args: unknown, ctx: ActionContext) => unknown): () => void;
  /** Share a value with the assistant while it is registered (like `useSaydoContext`). */
  context(key: string, value: unknown): () => void;
  /** Block AI navigation while there are unsaved changes; pass null to clear (like `useSaydoGuard`). */
  guard(message: string | null): void;
  /** Tell Saydo the route changed (single-page apps). Default: the current location. */
  navigated(pathname?: string): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): RuntimeSnapshot;
  destroy(): void;
}

const pageLoads: RouterAdapter = {
  push: (href) => location.assign(href),
  replace: (href) => location.replace(href),
  refresh: () => location.reload(),
};

/**
 * Saydo without React: plain DOM, any framework (Vue, Svelte, Solid, Angular, server-rendered pages).
 *
 *   import { createSaydo } from 'saydo/dom';
 *   const saydo = createSaydo();
 *   saydo.action('theme.toggle', 'Switch between light and dark mode', () => toggleTheme());
 */
export function createSaydo(options: CreateSaydoOptions = {}): SaydoClient {
  const registry = new Registry();
  const runtime = new SaydoRuntime({
    endpoint: options.endpoint ?? '/api/saydo',
    registry,
    router: options.router ?? pageLoads,
    fetch: options.fetch,
    stepUp: options.stepUp,
    messages: options.messages,
    onInvalidate: options.onInvalidate,
  });
  const cleanups: (() => void)[] = [];
  const owner = Symbol('saydo-dom');

  runtime.notifyPath(location.pathname);
  const onPop = () => runtime.notifyPath(location.pathname);
  window.addEventListener('popstate', onPop);
  cleanups.push(() => window.removeEventListener('popstate', onPop));
  void runtime.loadManifest();

  if (options.hotkey !== false) {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        runtime.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    cleanups.push(() => window.removeEventListener('keydown', onKey));
  }

  if (options.agents) {
    let registered: unknown;
    let dispose: (() => void) | undefined;
    const sync = () => {
      const tools = runtime.getSnapshot().manifest?.agentTools;
      if (!tools || tools === registered) return;
      registered = tools;
      dispose?.();
      dispose = registerWebMcpTools(runtime, tools);
    };
    cleanups.push(runtime.subscribe(sync));
    cleanups.push(() => dispose?.());
  }

  if (options.ui !== false) {
    cleanups.push(mountUI(runtime, { ...defaultMessages, ...options.messages }, options.placeholder, options.root ?? document.body));
  }

  return {
    runtime,
    ask: (text) => runtime.send(text),
    open: () => runtime.setOpen(true),
    close: () => runtime.setOpen(false),
    action: (id, describe, run, extra) => registry.register(Symbol(id), { id, kind: 'ui', describe, inputSchema: extra?.input, run }),
    capability: (id, run) => registry.register(Symbol(id), { id, kind: 'capability', run }),
    context: (key, value) => {
      registry.setContext(key, value);
      return () => registry.removeContext(key);
    },
    guard: (message) => registry.setGuard(owner, message),
    navigated: (pathname) => runtime.notifyPath(pathname ?? location.pathname),
    subscribe: runtime.subscribe,
    getSnapshot: runtime.getSnapshot,
    destroy: () => {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      registry.setGuard(owner, null);
    },
  };
}

// ------------------------------------------------------------------ default UI (textContent only: model output is never parsed as HTML)

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false || value === null) continue;
    if (key === 'className') el.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

function fields(view: ConfirmPending['view']): HTMLElement | null {
  if (!view.fields.length) return null;
  return h('dl', {}, ...view.fields.flatMap((f) => [h('dt', {}, f.label), h('dd', { className: f.untrusted ? 'untrusted' : undefined }, f.value)]));
}

function confirmCard(runtime: SaydoRuntime, confirm: ConfirmPending, m: SaydoMessages) {
  const { view } = confirm;
  const needs = view.requireTyped;
  const titleId = `saydo-confirm-${confirm.grantId}`;
  const typed = needs ? h('input', { inputmode: 'numeric', autocomplete: 'off' }) : null;
  const error = h('p', { role: 'alert', className: 'saydo-error', hidden: true });
  const cancel = h('button', { type: 'button', onClick: () => void runtime.deny() }, m.cancel);
  const approve = h(
    'button',
    {
      type: 'button',
      className: 'primary',
      onClick: (event: MouseEvent) => void runtime.approve(event.isTrusted, needs ? typed!.value : undefined),
    },
    confirm.stepUp ? m.confirmWithPasskey : confirm.batch ? m.approveAll : (view.confirmLabel ?? m.confirm),
  );
  const el = h(
    'section',
    { className: `saydo-confirm${view.danger ? ' danger' : ''}`, 'aria-labelledby': titleId },
    h('p', { className: 'saydo-kicker' }, view.danger ? m.confirmKickerDanger : m.confirmKicker),
    h('h2', { id: titleId }, view.title),
    confirm.batch
      ? h('ol', { className: 'saydo-batch' }, ...confirm.batch.map((item) => h('li', {}, h('strong', {}, item.view.title), fields(item.view))))
      : fields(view),
    confirm.stepUpMissing && h('p', { className: 'saydo-hint' }, m.passkeyMissing),
    typed && h('label', {}, m.typeToConfirm(needs!), typed),
    error,
    h('div', { className: 'saydo-actions' }, cancel, approve),
    h('p', { className: 'saydo-fineprint' }, m.fineprint),
  );
  const update = (snap: RuntimeSnapshot) => {
    error.hidden = !snap.confirmError;
    error.textContent = snap.confirmError ?? '';
    cancel.disabled = snap.busy;
    approve.disabled = snap.busy || (!!needs && typed!.value.trim() !== needs);
  };
  typed?.addEventListener('input', () => update(runtime.getSnapshot()));
  return { el, update, grantId: confirm.grantId };
}

function mountUI(runtime: SaydoRuntime, m: SaydoMessages, placeholder: string | undefined, host: HTMLElement): () => void {
  let query = '';
  let active = -1;
  let wasOpen = false;
  let returnFocus: HTMLElement | null = null;
  let card: ReturnType<typeof confirmCard> | undefined;

  const live = h('div', { className: 'saydo-live', role: 'status', 'aria-live': 'polite' });
  const launcher = h(
    'button',
    { type: 'button', className: 'saydo-launcher', 'aria-label': m.launcherLabel, onClick: () => runtime.setOpen(true) },
    h('span', { 'aria-hidden': 'true' }, '✦'),
    ` ${m.launcher} `,
    h('kbd', { 'aria-hidden': 'true' }, '⌘K'),
  );
  const input = h('input', {
    placeholder: placeholder ?? m.placeholder,
    'aria-label': m.inputLabel,
    role: 'combobox',
    'aria-controls': 'saydo-pages',
    'aria-expanded': 'false',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const spinner = h('span', { className: 'saydo-spinner', role: 'img', 'aria-label': 'Working', hidden: true });
  const body = h('div', { className: 'saydo-body' });
  const newChat = h('button', { type: 'button', onClick: () => runtime.reset() }, m.newChat);
  const dialog = h(
    'div',
    { className: 'saydo-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': m.launcher },
    h('div', { className: 'saydo-inputrow' }, input, spinner),
    h('p', { className: 'saydo-disclosure' }, m.disclosure),
    body,
    h('div', { className: 'saydo-footer' }, h('span', {}, m.footer), h('span', {}, newChat)),
  );
  const overlay = h('div', { className: 'saydo-overlay', hidden: true }, dialog);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) runtime.setOpen(false);
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') runtime.setOpen(false);
  });
  const toasts = h('div', { className: 'saydo-toasts' });
  const style = h('style', {}, STYLES);
  const root = h('div', { className: 'saydo-root' }, style, live, launcher, overlay, toasts);
  host.append(root);

  const suggestions = () => {
    const snap = runtime.getSnapshot();
    const routes = snap.manifest?.routes ?? [];
    return query.trim() ? searchRoutes(query, routes, 6).map((r) => r.route) : snap.items.length ? [] : routes.slice(0, 12);
  };

  const submit = () => {
    const picked = active >= 0 ? suggestions()[active] : undefined;
    if (picked) void runtime.goTo(picked.pattern, picked.title);
    else if (query.trim()) void runtime.send(query);
    else return;
    query = '';
    input.value = '';
    active = -1;
    render();
  };

  input.addEventListener('input', () => {
    query = input.value;
    active = -1;
    render();
  });
  input.addEventListener('keydown', (event) => {
    const count = suggestions().length;
    if (event.key === 'ArrowDown') active = Math.min(active + 1, count - 1);
    else if (event.key === 'ArrowUp') active = Math.max(active - 1, -1);
    else if (event.key === 'Enter') submit();
    else if (event.key === 'Escape') runtime.setOpen(false);
    else return;
    event.preventDefault();
    render();
  });

  function render() {
    const snap = runtime.getSnapshot();
    live.textContent = snap.announcement;
    launcher.hidden = snap.open;
    overlay.hidden = !snap.open;
    spinner.hidden = !snap.busy;
    newChat.hidden = !snap.items.length;

    if (snap.open && !wasOpen) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => input.focus());
    } else if (!snap.open && wasOpen && returnFocus?.isConnected) {
      returnFocus.focus();
      returnFocus = null;
    }
    wasOpen = snap.open;

    if (snap.confirm?.grantId !== card?.grantId) card = snap.confirm ? confirmCard(runtime, snap.confirm, m) : undefined;
    card?.update(snap);

    const pages = suggestions();
    input.setAttribute('aria-expanded', String(pages.length > 0));
    if (active >= 0) input.setAttribute('aria-activedescendant', `saydo-page-${active}`);
    else input.removeAttribute('aria-activedescendant');

    body.replaceChildren(
      ...[
        snap.reloadRequired &&
          h('div', { className: 'saydo-notice' }, `${m.reloadNotice} `, h('button', { type: 'button', onClick: () => location.reload() }, m.reloadButton)),
        ...snap.items.map((item) => h('div', { className: `saydo-item saydo-${item.role}`, 'data-status': item.status }, item.text)),
        card?.el,
        pages.length > 0 &&
          h(
            'div',
            { id: 'saydo-pages', role: 'listbox', 'aria-label': m.pages },
            h('p', { className: 'saydo-section' }, m.pages),
            ...pages.map((route, index) =>
              h(
                'button',
                {
                  type: 'button',
                  id: `saydo-page-${index}`,
                  role: 'option',
                  'aria-selected': String(index === active),
                  className: 'saydo-option',
                  onClick: () => {
                    void runtime.goTo(route.pattern, route.title);
                    query = '';
                    input.value = '';
                  },
                },
                h('span', {}, route.title),
                h('small', {}, route.pattern),
              ),
            ),
          ),
        !snap.items.length && !query && h('p', { className: 'saydo-hint' }, m.hint),
      ].filter((n): n is HTMLElement => n instanceof HTMLElement),
    );
    body.scrollTop = body.scrollHeight;

    toasts.replaceChildren(
      ...snap.toasts.map((toast) =>
        h(
          'div',
          { className: 'saydo-toast', role: 'status' },
          h('span', {}, toast.message),
          toast.undo && h('button', { type: 'button', onClick: () => void runtime.undo(toast.undo!.token) }, m.undo),
          h('button', { type: 'button', 'aria-label': m.dismiss, onClick: () => runtime.dismissToast(toast.id) }, '×'),
        ),
      ),
    );
  }

  const unsubscribe = runtime.subscribe(render);
  render();
  return () => {
    unsubscribe();
    root.remove();
  };
}

export { SaydoRuntime, Registry, type RouterAdapter, type RuntimeSnapshot, type ActionContext, type SaydoMessages };
