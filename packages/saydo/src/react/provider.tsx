'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { RegistryContext, RuntimeContext } from './context';
import { defaultMessages, MessagesContext, type SaydoMessages } from './messages';
import type { StepUpChallenge } from '../core/index';
import { Registry } from './registry';
import { SaydoRuntime, type RouterAdapter } from './runtime';
import { AssistantUI } from './ui';
import { registerWebMcpTools } from './webmcp';

export interface SaydoProviderProps {
  children: ReactNode;
  /** Router adapter. `saydo/next/client` wires the App Router for you. */
  router: RouterAdapter;
  /** Current pathname, so the runtime knows when a navigation has landed. */
  pathname: string;
  /** Route handler path. Default '/api/saydo'. */
  endpoint?: string;
  /** Render the default palette/assistant UI. Default true. */
  ui?: boolean;
  /** Toggle the palette with Cmd/Ctrl+K. Default true. */
  hotkey?: boolean;
  placeholder?: string;
  /** Translate or rephrase any UI text. */
  messages?: Partial<SaydoMessages>;
  /** Custom step-up proof (default: WebAuthn passkey). */
  stepUp?: (challenge: StepUpChallenge) => Promise<unknown>;
  /**
   * Expose actions marked `expose: { browserAgent: true }` to in-page browser agents through
   * WebMCP (document.modelContext). Off by default.
   */
  agents?: boolean;
  /**
   * Keep client caches in sync with AI writes. Called with the keys from `invalidate(...)`,
   * or with no keys after any write (refetch everything visible):
   *   onInvalidate={(keys) => queryClient.invalidateQueries(keys ? { queryKey: keys } : undefined)}
   */
  onInvalidate?: (keys?: string[]) => void;
  /** Show replies as the model writes them. Default true. */
  stream?: boolean;
}

export function SaydoProvider({
  children,
  router,
  pathname,
  endpoint = '/api/saydo',
  ui = true,
  hotkey = true,
  placeholder,
  messages,
  stepUp,
  agents = false,
  onInvalidate,
  stream = true,
}: SaydoProviderProps) {
  const invalidateRef = useRef(onInvalidate);
  useEffect(() => {
    invalidateRef.current = onInvalidate;
  });
  const text = useMemo(() => ({ ...defaultMessages, ...messages }), [messages]);
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });
  const [registry] = useState(() => new Registry());
  const [runtime] = useState(
    () =>
      new SaydoRuntime({
        endpoint,
        registry,
        router: {
          push: (href) => routerRef.current.push(href),
          replace: (href) => (routerRef.current.replace ?? routerRef.current.push)(href),
          refresh: () => routerRef.current.refresh?.(),
        },
        messages: { offline: text.offline, guardBlocked: text.guardBlocked },
        stepUp,
        onInvalidate: (keys) => invalidateRef.current?.(keys),
        stream,
      }),
  );

  useEffect(() => {
    runtime.notifyPath(pathname);
  }, [runtime, pathname]);

  useEffect(() => {
    void runtime.loadManifest();
  }, [runtime]);

  const agentTools = useSyncExternalStore(runtime.subscribe, () => runtime.getSnapshot().manifest?.agentTools, () => undefined);
  useEffect(() => {
    if (!agents || !agentTools?.length) return;
    return registerWebMcpTools(runtime, agentTools);
  }, [runtime, agents, agentTools]);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        runtime.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runtime, hotkey]);

  return (
    <RegistryContext.Provider value={registry}>
      <RuntimeContext.Provider value={runtime}>
        <MessagesContext.Provider value={text}>
          {children}
          {ui && <AssistantUI placeholder={placeholder} />}
        </MessagesContext.Provider>
      </RuntimeContext.Provider>
    </RegistryContext.Provider>
  );
}
