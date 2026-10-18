import {
  fastPath,
  GRANT_HEADER,
  INVOCATION_HEADER,
  type ClientContext,
  type ClientManifest,
  type Effect,
  type InvokeResult,
  type PendingAction,
  type Receipt,
  type ReceiptStatus,
  type StepUpChallenge,
  type TurnRequest,
  type TurnResult,
} from '../core/index';
import { actOnElement, identify, snapshotPage, type ElementAction } from './page';
import type { Registry } from './registry';

export interface RouterAdapter {
  push(href: string): void;
  replace?(href: string): void;
  refresh?(): void;
}

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant' | 'action' | 'notice';
  text: string;
  status?: ReceiptStatus;
}

export interface ToastItem {
  id: string;
  message: string;
  undo?: { token: string; label: string; expiresAt: number };
}

/** A confirmation in the palette; `agent` marks a request from an in-page browser agent (WebMCP). */
export type ConfirmPending = Extract<PendingAction, { type: 'confirm' }> & { agent?: boolean };

export interface RuntimeSnapshot {
  open: boolean;
  busy: boolean;
  items: ChatItem[];
  confirm?: ConfirmPending;
  confirmError?: string;
  manifest?: ClientManifest;
  toasts: ToastItem[];
  announcement: string;
  reloadRequired: boolean;
  offline: boolean;
}

/** Dev-only view of what the model sees on this page. */
export interface InspectResult {
  ok: true;
  instructions: string;
  tools: Array<{ name: string; description: string }>;
  lock: { capabilities: Record<string, { risk: string; kind: string }> };
  page: { route: string; screen?: string; elements?: Array<{ ref: string; role: string; name: string; risk?: string }> };
  estimate?: { inputTokens: number; costUsd?: number };
}

export interface RuntimeOptions {
  endpoint: string;
  registry: Registry;
  router: RouterAdapter;
  fetch?: typeof fetch;
  tabId?: string;
  navigationTimeoutMs?: number;
  mountTimeoutMs?: number;
  /** Override heading focus after AI navigation (tests, custom layouts). */
  onNavigated?: (href: string) => void;
  /** Max characters of page outline sent per turn. Default 12000. */
  pageBudget?: number;
  messages?: { offline?: string; guardBlocked?: string };
  /** Produce a step-up proof (default: the user's passkey via WebAuthn). */
  stepUp?: (challenge: StepUpChallenge) => Promise<unknown>;
}

let itemSeq = 0;
const newRequestId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const nextId = () => `i${++itemSeq}`;

function getTabId(): string {
  const random = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    const existing = sessionStorage.getItem('saydo-tab');
    if (existing) return existing;
    const id = random();
    sessionStorage.setItem('saydo-tab', id);
    return id;
  } catch {
    return random();
  }
}

function focusMainHeading() {
  if (typeof document === 'undefined') return;
  const heading = document.querySelector('main h1') ?? document.querySelector('h1');
  if (heading instanceof HTMLElement) {
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: false });
  }
}

const isReceiptLike = (value: unknown): value is Receipt =>
  !!value && typeof value === 'object' && typeof (value as Receipt).status === 'string';

function toJson(value: unknown): unknown {
  try {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

/**
 * Client half of the protocol: sends turns, applies effects, runs dispatched
 * actions against mounted components, and shows confirmations. Framework
 * agnostic; React reads it through useSyncExternalStore.
 */
export class SaydoRuntime {
  private snapshot: RuntimeSnapshot = {
    open: false,
    busy: false,
    items: [],
    toasts: [],
    announcement: '',
    reloadRequired: false,
    offline: false,
  };
  private readonly listeners = new Set<() => void>();
  private state?: string;
  private pathname = '/';
  private waiters: Array<{ target: string; resolve: (arrived: boolean) => void }> = [];
  private controller?: AbortController;
  private pageRefs = new Map<string, Element>();
  private agentWaiters = new Map<string, (result: InvokeResult) => void>();
  readonly tabId: string;

  constructor(private readonly options: RuntimeOptions) {
    this.tabId = options.tabId ?? getTabId();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<RuntimeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private add(item: Omit<ChatItem, 'id'>) {
    this.set({ items: [...this.snapshot.items, { ...item, id: nextId() }].slice(-100) });
  }

  setOpen(open: boolean) {
    this.set({ open });
  }

  toggle() {
    this.set({ open: !this.snapshot.open });
  }

  dismissToast(id: string) {
    this.set({ toasts: this.snapshot.toasts.filter((t) => t.id !== id) });
  }

  /** Called by the provider whenever the router's pathname changes. */
  notifyPath(pathname: string) {
    this.pathname = pathname;
    const ready = this.waiters.filter((w) => w.target === pathname);
    this.waiters = this.waiters.filter((w) => w.target !== pathname);
    ready.forEach((w) => w.resolve(true));
  }

  private waitForPath(href: string): Promise<boolean> {
    const target = href.split(/[?#]/)[0] || '/';
    if (this.pathname === target) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiter = { target, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        if (this.waiters.includes(waiter)) {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          resolve(false);
        }
      }, this.options.navigationTimeoutMs ?? 8000);
    });
  }

  private currentRoute(): string {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    return `${this.pathname}${search}`;
  }

  private client(): ClientContext {
    const { registry } = this.options;
    // Until the manifest arrives, assume the server defaults; the server filters anyway.
    const settings = this.snapshot.manifest?.settings ?? { page: true, elements: 'all' as const };
    let page: ClientContext['page'];
    if (typeof document !== 'undefined' && (settings.page || settings.elements !== 'none')) {
      const { snapshot, refs } = snapshotPage({ elements: settings.elements, maxChars: this.options.pageBudget });
      this.pageRefs = refs;
      page = settings.page ? snapshot : { text: '', elements: snapshot.elements, truncated: false };
    }
    return {
      route: this.currentRoute(),
      tabId: this.tabId,
      mounted: registry.ids(),
      uiActions: registry.uiDescriptors(),
      context: registry.contextSnapshot(),
      page,
      guard: registry.activeGuard(),
      manifestHash: this.snapshot.manifest?.manifestHash,
    };
  }

  /** Find the exact element that was approved, even if the page re-rendered since. */
  private resolveElement(args: { ref: string; role: string; name: string; context?: string }): Element | null {
    const same = (el: Element) => {
      const id = identify(el);
      return id.role === args.role && id.name === args.name;
    };
    const candidate = this.pageRefs.get(args.ref);
    if (candidate?.isConnected && same(candidate)) return candidate;
    const { snapshot, refs } = snapshotPage({ elements: 'all' });
    const matches = snapshot.elements.filter(
      (e) => e.role === args.role && e.name === args.name && (args.context === undefined || e.context === args.context),
    );
    return matches.length === 1 ? (refs.get(matches[0]!.ref) ?? null) : null;
  }

  async loadManifest() {
    const data = (await this.post({ type: 'manifest' }, false)) as ClientManifest | null;
    if (data && Array.isArray(data.routes)) this.set({ manifest: data });
  }

  /** Human-initiated navigation from the palette. */
  async goTo(href: string, title?: string) {
    this.set({ open: false });
    await this.navigate(href, title, false);
  }

  async send(text: string) {
    const message = text.trim();
    // While a network request is in flight, wait; while a dispatched action is
    // waiting to mount or run, the human wins and it is abandoned.
    if (!message || (this.snapshot.busy && !this.controller)) return;
    this.controller?.abort();
    this.controller = undefined;
    this.add({ role: 'user', text: message });
    const local = fastPath(message, this.snapshot.manifest?.routes ?? []);
    if (local && this.options.registry.activeGuard()) {
      this.add({ role: 'notice', text: this.options.messages?.guardBlocked ?? this.options.registry.activeGuard()!, status: 'blocked' });
      return;
    }
    if (local) {
      this.add({ role: 'assistant', text: `Opening ${local.title}.` });
      this.set({ open: false });
      await this.navigate(local.pattern, local.title, true);
      return;
    }
    await this.request({ type: 'message', text: message, state: this.state, client: this.client() });
  }

  /**
   * Browser agents (WebMCP) call this. The same policy applies; a gated call shows the normal
   * confirm card and the agent waits for the user's decision.
   */
  async invokeAgent(tool: string, args: unknown): Promise<InvokeResult | null> {
    const result = (await this.post({ type: 'invoke', tool, args, client: this.client(), requestId: newRequestId() }, false)) as InvokeResult | null;
    if (!result || !result.ok || result.status !== 'needs_approval') return result;
    const { approval } = result;
    return new Promise((resolve) => {
      this.agentWaiters.set(approval.grantId, resolve);
      this.add({ role: 'notice', text: `A browser agent asked to: ${approval.view.title}` });
      this.set({
        open: true,
        confirm: {
          type: 'confirm',
          toolCallId: '',
          grantId: approval.grantId,
          capability: approval.capability,
          view: approval.view,
          tier: approval.tier,
          expiresAt: approval.expiresAt,
          stepUp: approval.stepUp,
          stepUpMissing: approval.stepUpMissing,
          agent: true,
        },
      });
    });
  }

  private async decideAgent(confirm: ConfirmPending, approved: boolean, trusted: boolean, typed?: string, proof?: unknown) {
    this.set({ busy: true, confirmError: undefined });
    try {
      const result = (await this.call({ type: 'grant-approve', grantId: confirm.grantId, approved, trusted, typed, proof })) as InvokeResult | null;
      if (result && !result.ok && approved && (result.status === 'invalid_args' || result.status === 'denied') && result.code !== 'step_up_unavailable') {
        this.set({ confirmError: result.message });
        return;
      }
      this.set({ confirm: undefined });
      const final: InvokeResult = result ?? { ok: false, status: 'error', message: 'Network error.', fix: 'Try again.' };
      this.add({ role: 'action', text: final.ok && final.status !== 'needs_approval' ? (final.receipt.message ?? final.status) : final.ok ? '' : final.message, status: final.ok ? (final.status === 'needs_approval' ? 'needs_confirmation' : final.status) : final.status });
      this.agentWaiters.get(confirm.grantId)?.(final);
      this.agentWaiters.delete(confirm.grantId);
    } finally {
      this.set({ busy: false });
    }
  }

  /** `trusted` must come from the click event's `isTrusted`. Asks for the passkey when the server requires it. */
  async approve(trusted: boolean, typed?: string) {
    const confirm = this.snapshot.confirm;
    if (!confirm) return;
    let proof: unknown;
    if (confirm.agent) {
      if (confirm.stepUp) {
        try {
          proof = await (this.options.stepUp ?? (await import('./webauthn-proof')).webauthnProof)(confirm.stepUp);
        } catch (error) {
          this.set({ confirmError: error instanceof Error ? error.message : 'Passkey confirmation was cancelled.' });
          return;
        }
      }
      return this.decideAgent(confirm, true, trusted, typed, proof);
    }
    if (!this.state) return;
    if (confirm.stepUp) {
      try {
        proof = await (this.options.stepUp ?? (await import('./webauthn-proof')).webauthnProof)(confirm.stepUp);
      } catch (error) {
        this.set({ confirmError: error instanceof Error ? error.message : 'Passkey confirmation was cancelled.' });
        return;
      }
    }
    await this.request(
      { type: 'approve', state: this.state, grantId: confirm.grantId, approved: true, trusted, typed, proof, client: this.client() },
      confirm,
    );
  }

  /** Low-level request to the Saydo endpoint (passkey management, agent tools). */
  call(body: Record<string, unknown>): Promise<unknown> {
    return this.post({ ...body, requestId: newRequestId() }, false);
  }

  async deny() {
    const confirm = this.snapshot.confirm;
    if (confirm?.agent) return this.decideAgent(confirm, false, true);
    if (!confirm || !this.state) return;
    await this.request({ type: 'approve', state: this.state, grantId: confirm.grantId, approved: false, client: this.client() });
  }

  async undo(token: string) {
    this.set({ toasts: this.snapshot.toasts.filter((t) => t.undo?.token !== token) });
    await this.request({ type: 'undo', token, state: this.state, client: this.client() });
  }

  /** Development only: ask the server what the model would see on this page right now. */
  async inspect(): Promise<InspectResult | null> {
    const data = (await this.post({ type: 'inspect', client: this.client() }, false)) as InspectResult | { ok: false } | null;
    return data && data.ok ? data : null;
  }

  reset() {
    this.state = undefined;
    this.set({ items: [], confirm: undefined, confirmError: undefined });
  }

  private async request(body: TurnRequest, restoreConfirm?: ConfirmPending) {
    this.set({ busy: true, confirm: undefined, confirmError: undefined });
    try {
      // The same requestId on a retry lets the server return the stored result instead of running twice.
      const result = (await this.post({ ...body, requestId: newRequestId() })) as TurnResult | null;
      if (result) await this.handle(result, restoreConfirm);
      else if (restoreConfirm) this.set({ confirm: restoreConfirm });
    } finally {
      this.set({ busy: false });
    }
  }

  private async post(body: unknown, report = true): Promise<unknown> {
    const attempt = async () => {
      const response = await (this.options.fetch ?? fetch)(this.options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error(`Unexpected response (${response.status})`);
      return data;
    };
    try {
      let data: unknown;
      try {
        data = await attempt();
      } catch {
        // One retry for network blips; requestId makes it safe.
        await new Promise((resolve) => setTimeout(resolve, 500));
        data = await attempt();
      }
      if (this.snapshot.offline) this.set({ offline: false });
      return data;
    } catch {
      if (report) {
        this.set({ offline: true });
        this.add({
          role: 'notice',
          text: this.options.messages?.offline ?? 'The assistant is unavailable right now. You can still jump to any page from the list.',
        });
      }
      return null;
    }
  }

  private async handle(result: TurnResult, restoreConfirm?: ConfirmPending) {
    if (!result.ok) {
      if (result.status === 'reload_required') this.set({ reloadRequired: true });
      if (restoreConfirm && (result.status === 'invalid_args' || result.status === 'denied')) {
        // Wrong step-up text or an untrusted click: keep the card open with the reason.
        this.set({ confirm: restoreConfirm, confirmError: result.message });
        return;
      }
      if (['forbidden', 'expired', 'error'].includes(result.status)) this.state = undefined;
      this.add({ role: 'notice', text: `${result.message} ${result.fix}`.trim(), status: result.status });
      return;
    }
    this.state = result.state;
    for (const event of result.events) {
      if (event.type === 'assistant') this.add({ role: 'assistant', text: event.text });
      else if (event.status !== 'ok' || event.capability !== 'nav_goto') {
        this.add({ role: 'action', text: event.message ?? `${event.title}: ${event.status}`, status: event.status });
      }
    }
    await this.applyEffects(result.effects);
    if (result.pending?.type === 'confirm') {
      this.set({ confirm: result.pending, open: true });
      return;
    }
    if (result.pending?.type === 'dispatch') {
      await this.dispatch(result.pending);
      return;
    }
    if (result.done && result.effects.some((e) => e.type === 'navigate')) this.set({ open: false });
  }

  private async applyEffects(effects: Effect[]) {
    for (const effect of effects) {
      if (effect.type === 'navigate') await this.navigate(effect.href, effect.title, true);
      else if (effect.type === 'refresh') this.options.router.refresh?.();
      else if (effect.type === 'toast') this.toast({ message: effect.message });
      else if (effect.type === 'undo') this.toast({ message: effect.label, undo: effect }, Math.min(effect.expiresAt - Date.now(), 15_000));
    }
  }

  private toast(toast: Omit<ToastItem, 'id'>, ttl = 5000) {
    const id = nextId();
    this.set({ toasts: [...this.snapshot.toasts, { ...toast, id }].slice(-4) });
    setTimeout(() => this.dismissToast(id), Math.max(ttl, 1000));
  }

  private async navigate(href: string, title: string | undefined, byAssistant: boolean) {
    const guard = byAssistant ? this.options.registry.activeGuard() : undefined;
    if (guard) {
      this.toast({ message: this.options.messages?.guardBlocked ?? guard });
      return;
    }
    // push, not replace: Back undoes an AI navigation.
    this.options.router.push(href);
    const arrived = await this.waitForPath(href);
    const label = title ?? href;
    this.set({ announcement: arrived ? `${byAssistant ? 'Assistant opened' : 'Opened'} ${label}` : `Opening ${label}` });
    if (arrived && !this.snapshot.open) (this.options.onNavigated ?? focusMainHeading)(href);
  }

  private async dispatch(pending: Extract<PendingAction, { type: 'dispatch' }>) {
    const { registry } = this.options;
    const controller = new AbortController();
    this.controller = controller;
    let result: Receipt;
    if (pending.kind === 'element') {
      const args = pending.args as { ref: string; action: ElementAction; value?: string; role: string; name: string; context?: string };
      const element = this.resolveElement(args);
      if (!element) {
        result = { status: 'not_found', message: `Could not find "${args.name}" on the page any more.` };
      } else {
        try {
          result = { status: 'ok', message: await actOnElement(element, args.action, args.value) };
        } catch (error) {
          const e = error as { status?: ReceiptStatus; hint?: string };
          result = { status: e.status ?? 'error', message: e.hint ?? 'The action failed in the browser.' };
        }
        // Let the app re-render (or navigate) before the next screen is read.
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (this.controller === controller) this.controller = undefined;
      if (controller.signal.aborted || !this.state) return;
      await this.request({ type: 'receipt', state: this.state, toolCallId: pending.toolCallId, receipt: result, client: this.client() });
      return;
    }
    if (pending.entry && !registry.get(pending.target)) await this.navigate(pending.entry, undefined, true);
    const mounted = await registry.waitFor(pending.target, this.options.mountTimeoutMs ?? 5000, controller.signal);
    const action = registry.get(pending.target);
    if (!mounted || !action) {
      result = { status: 'not_ready', message: 'That action is not available on this page.' };
    } else {
      const headers: Record<string, string> = { [INVOCATION_HEADER]: pending.toolCallId };
      if (pending.grant) headers[GRANT_HEADER] = pending.grant;
      const boundFetch: typeof fetch = (input, init = {}) => {
        const merged = new Headers(init.headers);
        for (const [key, value] of Object.entries(headers)) merged.set(key, value);
        return fetch(input, { ...init, headers: merged });
      };
      try {
        const output = await action.run(pending.args, {
          signal: controller.signal,
          headers,
          fetch: boundFetch,
          grant: pending.grant,
          invocationId: pending.toolCallId,
        });
        result = isReceiptLike(output) ? output : { status: 'ok', result: toJson(output) };
      } catch (error) {
        const e = error as { status?: ReceiptStatus; hint?: string };
        result =
          typeof e?.status === 'string' && typeof e.hint === 'string'
            ? { status: e.status, message: e.hint }
            : { status: 'error', message: 'The action failed in the browser.' };
      }
    }
    if (this.controller === controller) this.controller = undefined;
    if (controller.signal.aborted || !this.state) return; // the user moved on
    await this.request({ type: 'receipt', state: this.state, toolCallId: pending.toolCallId, receipt: result, client: this.client() });
  }
}
