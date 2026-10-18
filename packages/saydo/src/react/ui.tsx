'use client';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { searchRoutes, type ThreadSummary } from '../core/index';
import { useConversations, useSaydo } from './hooks';
import { useRuntime } from './context';
import { useMessages } from './messages';
import type { ConfirmPending, InspectResult } from './runtime';
import { STYLES } from './styles';

/** Default assistant UI: ⌘K palette + conversation + confirm card + undo toasts. */
const isDev = typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';
const toolKey = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

/** Development aid: everything the model sees and can do on this page, with risks. */
function DevInspector() {
  const runtime = useRuntime();
  const [data, setData] = useState<InspectResult | null | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    void runtime.inspect().then((result) => live && setData(result));
    return () => {
      live = false;
    };
  }, [runtime]);
  if (data === 'loading') return <p className="saydo-hint">Inspecting…</p>;
  if (!data) return <p className="saydo-hint">Inspect is available in development only.</p>;
  const risks = new Map(Object.entries(data.lock.capabilities).map(([id, entry]) => [toolKey(id), entry.risk]));
  const builtIn: Record<string, string> = { nav_goto: 'navigate', entities_find: 'read', page_act: 'per element', find_capability: 'read' };
  return (
    <div className="saydo-inspect">
      <p className="saydo-section">
        Tools the model gets here ({data.tools.length})
        {data.estimate && ` · ~${data.estimate.inputTokens.toLocaleString()} input tokens per step${data.estimate.costUsd !== undefined ? ` (~$${data.estimate.costUsd.toFixed(4)})` : ''}`}
      </p>
      <ul>
        {data.tools.map((tool) => (
          <li key={tool.name}>
            <code>{tool.name}</code> <span className="saydo-pill">{builtIn[tool.name] ?? risks.get(tool.name) ?? (tool.name.startsWith('ui_') ? 'ui' : '?')}</span>
            <small>{tool.description.split('\n')[0]?.slice(0, 120)}</small>
          </li>
        ))}
      </ul>
      {data.page.elements && data.page.elements.length > 0 && (
        <>
          <p className="saydo-section">Operable elements ({data.page.elements.length})</p>
          <ul>
            {data.page.elements.slice(0, 50).map((el) => (
              <li key={el.ref}>
                <code>{el.ref}</code> {el.role} “{el.name}” {el.risk && <span className="saydo-pill">{el.risk}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {data.page.screen && (
        <>
          <p className="saydo-section">Screen outline</p>
          <pre className="saydo-pre">{data.page.screen.slice(0, 4000)}</pre>
        </>
      )}
    </div>
  );
}

export function AssistantUI({ placeholder }: { placeholder?: string }) {
  const nav = useSaydo();
  const m = useMessages();
  const [inspecting, setInspecting] = useState(false);
  const conversations = useConversations();
  const [history, setHistory] = useState<ThreadSummary[] | null>(null);
  const toggleHistory = async () => {
    if (history) return setHistory(null);
    setHistory([]);
    setHistory(await conversations.list());
  };
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const routes = nav.manifest?.routes ?? [];
  const suggestions = useMemo(
    () => (query.trim() ? searchRoutes(query, routes, 6).map((r) => r.route) : nav.items.length ? [] : routes.slice(0, 12)),
    [query, routes, nav.items.length],
  );

  useEffect(() => {
    if (nav.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (returnFocus.current?.isConnected) {
      returnFocus.current.focus();
      returnFocus.current = null;
    }
  }, [nav.open]);

  useEffect(() => setActive(-1), [query]);
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [nav.items.length, nav.confirm, nav.streaming]);

  const submit = () => {
    const picked = active >= 0 ? suggestions[active] : undefined;
    if (picked) {
      void nav.goTo(picked.pattern, picked.title);
    } else if (query.trim()) {
      void nav.send(query);
    } else return;
    setQuery('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      nav.setOpen(false);
    }
  };

  return (
    <div className="saydo-root">
      <style>{STYLES}</style>
      <div className="saydo-live" role="status" aria-live="polite">
        {nav.announcement}
      </div>

      {!nav.open && (
        <button type="button" className="saydo-launcher" onClick={() => nav.setOpen(true)} aria-label={m.launcherLabel}>
          <span aria-hidden="true">✦</span> {m.launcher} <kbd aria-hidden="true">⌘K</kbd>
        </button>
      )}

      {nav.open && (
        <div
          className="saydo-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) nav.setOpen(false);
          }}
        >
          <div
            className="saydo-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={m.launcher}
            onKeyDown={(event) => {
              if (event.key === 'Escape') nav.setOpen(false);
            }}
          >
            <div className="saydo-inputrow">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder ?? m.placeholder}
                aria-label={m.inputLabel}
                role="combobox"
                aria-expanded={suggestions.length > 0}
                aria-controls="saydo-pages"
                aria-activedescendant={active >= 0 ? `saydo-page-${active}` : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              {nav.busy && <span className="saydo-spinner" role="img" aria-label="Working" />}
            </div>

            <p className="saydo-disclosure">{m.disclosure}</p>
            <div className="saydo-body" ref={bodyRef}>
              {nav.reloadRequired && (
                <div className="saydo-notice">
                  {m.reloadNotice}{' '}
                  <button type="button" onClick={() => location.reload()}>
                    {m.reloadButton}
                  </button>
                </div>
              )}
              {nav.items.map((item) => (
                <div key={item.id} className={`saydo-item saydo-${item.role}`} data-status={item.status}>
                  {item.text}
                </div>
              ))}
              {nav.streaming && (
                // The reply as it is written; screen readers get the final text instead of every token.
                <div className="saydo-item saydo-assistant saydo-streaming" aria-hidden="true">
                  {nav.streaming}
                </div>
              )}
              {nav.confirm && (
                <ConfirmCard
                  confirm={nav.confirm}
                  error={nav.confirmError}
                  busy={nav.busy}
                  onApprove={(trusted, typed) => void nav.approve(trusted, typed)}
                  onDeny={() => void nav.deny()}
                />
              )}
              {suggestions.length > 0 && (
                <div id="saydo-pages" role="listbox" aria-label={m.pages}>
                  <p className="saydo-section">{m.pages}</p>
                  {suggestions.map((route, index) => (
                    <button
                      type="button"
                      key={route.pattern}
                      id={`saydo-page-${index}`}
                      role="option"
                      aria-selected={index === active}
                      className="saydo-option"
                      onClick={() => {
                        void nav.goTo(route.pattern, route.title);
                        setQuery('');
                      }}
                    >
                      <span>{route.title}</span>
                      <small>{route.pattern}</small>
                    </button>
                  ))}
                </div>
              )}
              {history && (
                <div className="saydo-history" aria-label={m.history}>
                  <p className="saydo-section">{m.history}</p>
                  {!history.length && <p className="saydo-hint">{m.historyEmpty}</p>}
                  {history.map((thread) => (
                    <div key={thread.id} className="saydo-option" aria-current={thread.id === conversations.current ? 'true' : undefined}>
                      <button
                        type="button"
                        onClick={() => {
                          setHistory(null);
                          void conversations.open(thread.id);
                        }}
                      >
                        <span>{thread.title}</span>
                        <small>{new Date(thread.updatedAt).toLocaleString()}</small>
                      </button>
                      <button
                        type="button"
                        aria-label={`${m.deleteConversation}: ${thread.title}`}
                        onClick={async () => {
                          if (await conversations.remove(thread.id)) setHistory((list) => list?.filter((t) => t.id !== thread.id) ?? null);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {inspecting && isDev && <DevInspector />}
              {!nav.items.length && !query && !inspecting && !history && (
                <p className="saydo-hint">{m.hint}</p>
              )}
            </div>

            <div className="saydo-footer">
              <span>{m.footer}</span>
              <span>
                {conversations.enabled && (
                  <>
                    <button type="button" onClick={() => void toggleHistory()}>
                      {history ? m.historyHide : m.history}
                    </button>
                    {' · '}
                  </>
                )}
                {isDev && (
                  <button type="button" onClick={() => setInspecting((v) => !v)}>
                    {inspecting ? m.inspectorHide : m.inspectorShow}
                  </button>
                )}
                {nav.items.length > 0 && (
                  <>
                    {' · '}
                    <button type="button" onClick={nav.reset}>
                      {m.newChat}
                    </button>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="saydo-toasts">
        {nav.toasts.map((toast) => (
          <div className="saydo-toast" key={toast.id} role="status">
            <span>{toast.message}</span>
            {toast.undo && (
              <button type="button" onClick={() => void nav.undo(toast.undo!.token)}>
                {m.undo}
              </button>
            )}
            <button type="button" aria-label={m.dismiss} onClick={() => nav.dismissToast(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders the server-built ConfirmView: the exact arguments that will run,
 * never model prose. Approval passes the click's `isTrusted` to the server.
 */
export function ConfirmCard({
  confirm,
  error,
  busy,
  onApprove,
  onDeny,
}: {
  confirm: ConfirmPending;
  error?: string;
  busy?: boolean;
  onApprove: (trusted: boolean, typed?: string) => void;
  onDeny: () => void;
}) {
  const [typed, setTyped] = useState('');
  const m = useMessages();
  const { view } = confirm;
  const needs = view.requireTyped;
  const ready = !needs || typed.trim() === needs;
  const titleId = `saydo-confirm-${confirm.grantId}`;
  return (
    <section className={`saydo-confirm${view.danger ? ' danger' : ''}`} aria-labelledby={titleId}>
      <p className="saydo-kicker">{view.danger ? m.confirmKickerDanger : m.confirmKicker}</p>
      <h2 id={titleId}>{view.title}</h2>
      {confirm.batch ? (
        <ol className="saydo-batch">
          {confirm.batch.map((item) => (
            <li key={item.grantId}>
              <strong>{item.view.title}</strong>
              {item.view.fields.length > 0 && (
                <dl>
                  {item.view.fields.map((field) => (
                    <div key={field.label} style={{ display: 'contents' }}>
                      <dt>{field.label}</dt>
                      <dd className={field.untrusted ? 'untrusted' : undefined}>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ol>
      ) : view.fields.length > 0 && (
        <dl>
          {view.fields.map((field) => (
            <div key={field.label} style={{ display: 'contents' }}>
              <dt>{field.label}</dt>
              <dd className={field.untrusted ? 'untrusted' : undefined}>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {confirm.stepUpMissing && <p className="saydo-hint">{m.passkeyMissing}</p>}
      {needs && (
        <label>
          {m.typeToConfirm(needs)}
          <input value={typed} onChange={(event) => setTyped(event.target.value)} inputMode="numeric" autoComplete="off" />
        </label>
      )}
      {error && (
        <p role="alert" className="saydo-error">
          {error}
        </p>
      )}
      <div className="saydo-actions">
        <button type="button" onClick={onDeny} disabled={busy}>
          {m.cancel}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!ready || busy}
          onClick={(event) => onApprove(event.nativeEvent.isTrusted, needs ? typed : undefined)}
        >
          {confirm.stepUp ? m.confirmWithPasskey : confirm.batch ? m.approveAll : (view.confirmLabel ?? m.confirm)}
        </button>
      </div>
      <p className="saydo-fineprint">{m.fineprint}</p>
    </section>
  );
}
