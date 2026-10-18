import type { PageElement, PageSnapshot, Risk } from '../core/index';

/**
 * Reads the visible page the way a user sees it: headings, text, tables, form
 * fields with their values, and every element the user could operate, each
 * with a short ref (e1, e2, …) the model can act on.
 *
 * The developer controls it with plain attributes:
 *   data-saydo-private     never read or operated (subtree)
 *   data-saydo="off"       visible, but the assistant may not operate it
 *   data-saydo="…"         describe what an element does (and mark it annotated)
 *   data-saydo-risk="read|reversible|write|destructive|never"
 *   data-saydo-untrusted   user-generated content: readable as untrusted, never operable
 */
export interface SnapshotOptions {
  /** Which elements the assistant may operate. */
  elements: 'all' | 'annotated' | 'none';
  maxChars?: number;
  root?: Element;
  /** Extra selectors to treat like data-saydo-private. */
  privateSelectors?: string[];
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'OBJECT', 'CANVAS', 'VIDEO', 'AUDIO', 'HEAD']);
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'FORM', 'FIELDSET', 'TABLE', 'TR', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'FIGCAPTION', 'DIALOG', 'DETAILS', 'SUMMARY', 'LABEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'BR']);
const RISKS: Risk[] = ['read', 'reversible', 'write', 'destructive', 'never'];
const SENSITIVE_AUTOCOMPLETE = /^(cc-|current-password|new-password|one-time-code)/;

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

function isHidden(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert')) return true;
  if (el.tagName === 'DIALOG' && !el.hasAttribute('open')) return true;
  if (el instanceof HTMLInputElement && el.type === 'hidden') return true;
  const checkVisibility = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof checkVisibility === 'function') {
    return !checkVisibility.call(el, { checkOpacity: false, checkVisibilityCSS: true });
  }
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style?.display === 'none' || style?.visibility === 'hidden';
}

function textOf(el: Element | null | undefined): string {
  return clean(el?.textContent ?? '');
}

/** Text with spaces between nodes, so table cells and list items do not run together. */
function readableText(el: Element): string {
  const parts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? '');
  return clean(parts.join(' '));
}

/** A pragmatic accessible name: aria-label, labelledby, <label>, placeholder, title, text. */
function nameOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return clean(aria);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => textOf(el.ownerDocument.getElementById(id))).join(' ');
    if (clean(text)) return clean(text);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labels = el.labels ? [...el.labels].map((l) => textOf(l)).filter(Boolean) : [];
    if (labels.length) return labels.join(' ');
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return clean(placeholder);
    if (el.name) return el.name;
  }
  if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button')) return clean(el.value);
  if (el instanceof HTMLImageElement) return clean(el.alt);
  const title = el.getAttribute('title');
  const text = textOf(el);
  return text || (title ? clean(title) : '');
}

function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  switch (el.tagName) {
    case 'A':
      return el.hasAttribute('href') ? 'link' : null;
    case 'BUTTON':
    case 'SUMMARY':
      return 'button';
    case 'SELECT':
      return 'combobox';
    case 'TEXTAREA':
      return 'textbox';
    case 'INPUT': {
      const type = (el as HTMLInputElement).type;
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return 'button';
      if (type === 'range') return 'slider';
      return 'textbox';
    }
  }
  if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) return 'textbox';
  return null;
}

const OPERABLE_ROLES = new Set(['link', 'button', 'combobox', 'textbox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'slider']);

function actionsFor(el: Element, role: string): PageElement['actions'] {
  if (role === 'textbox') return ['fill'];
  if (role === 'combobox' && el.tagName === 'SELECT') return ['select'];
  if (role === 'checkbox' || role === 'switch' || role === 'radio') return ['check', 'uncheck'];
  return ['click'];
}

function riskAttr(el: Element): Risk | undefined {
  const value = el.closest('[data-saydo-risk]')?.getAttribute('data-saydo-risk') as Risk | null;
  return value && RISKS.includes(value) ? value : undefined;
}

/** Non-sensitive field values a form would submit, for the confirm card. */
function formValuesOf(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of [...form.elements].slice(0, 40)) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) continue;
    if (field.closest('[data-saydo-private]') || field.disabled) continue;
    if (field instanceof HTMLInputElement) {
      if (['password', 'hidden', 'submit', 'button', 'file'].includes(field.type) || SENSITIVE_AUTOCOMPLETE.test(field.autocomplete)) continue;
      if ((field.type === 'checkbox' || field.type === 'radio') && !field.checked) continue;
    }
    const label = nameOf(field) || field.name;
    if (label) values[label.slice(0, 60)] = (field instanceof HTMLSelectElement ? clean(field.selectedOptions[0]?.text ?? '') : field.value).slice(0, 300);
    if (Object.keys(values).length >= 20) break;
  }
  return values;
}

/** Role and accessible name, used to re-find an approved element after re-renders. */
export function identify(el: Element): { role: string | null; name: string } {
  return { role: roleOf(el), name: nameOf(el).slice(0, 120) };
}

export interface SnapshotResult {
  snapshot: PageSnapshot;
  refs: Map<string, Element>;
}

export function snapshotPage(options: SnapshotOptions): SnapshotResult {
  const doc = typeof document !== 'undefined' ? document : null;
  const root = options.root ?? doc?.body;
  const refs = new Map<string, Element>();
  if (!root) return { snapshot: { text: '', elements: [], truncated: false }, refs };
  const maxChars = options.maxChars ?? 12_000;
  const privateSelector = ['[data-saydo-private]', '.saydo-root', ...(options.privateSelectors ?? [])].join(',');
  const lines: string[] = [];
  const elements: PageElement[] = [];
  let size = 0;
  let truncated = false;
  let current = '';

  const flush = () => {
    const line = clean(current);
    current = '';
    if (!line) return;
    if (size + line.length > maxChars) {
      truncated = true;
      return;
    }
    lines.push(line);
    size += line.length + 1;
  };

  const operable = (el: Element, untrusted: boolean): boolean => {
    if (options.elements === 'none' || untrusted) return false;
    if (el.closest('[data-saydo="off"]')) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (options.elements === 'annotated') {
      return Boolean(el.closest('[data-saydo]:not([data-saydo="off"]), form[toolname]'));
    }
    return true;
  };

  const addElement = (el: Element, role: string, untrusted: boolean): string | null => {
    if (!operable(el, untrusted)) return null;
    const ref = `e${elements.length + 1}`;
    const name = nameOf(el).slice(0, 120);
    const form = el.closest('form');
    const annotation = el.getAttribute('data-saydo');
    const entry: PageElement = {
      ref,
      role,
      name,
      actions: actionsFor(el, role),
      inForm: Boolean(form) && !(role === 'button' && (el as HTMLButtonElement).type === 'submit'),
      submits: role === 'button' && Boolean(form) && ((el as HTMLButtonElement).type ?? 'submit') === 'submit',
    };
    if (annotation && annotation !== 'off') entry.describe = annotation.slice(0, 200);
    const risk = riskAttr(el);
    if (risk) entry.risk = risk;
    if (el instanceof HTMLAnchorElement) {
      const href = el.getAttribute('href') ?? '';
      entry.href = href;
      const origin = typeof location !== 'undefined' ? location.origin : '';
      entry.external = /^[a-z][a-z0-9+.-]*:/i.test(href) && !(origin && href.startsWith(origin));
    }
    const container = el.closest('tr, li, article, [role="row"], [role="listitem"], [data-saydo-context]');
    if (container && container !== el) {
      const contextText = (container.getAttribute('data-saydo-context') ?? readableText(container)).slice(0, 120);
      if (contextText && contextText !== name) entry.context = contextText;
    }
    if (form) {
      if (entry.submits) entry.formValues = formValuesOf(form);
      const formName = form.getAttribute('data-saydo') ?? form.getAttribute('toolname') ?? form.getAttribute('aria-label') ?? '';
      if (formName && formName !== 'off') entry.form = formName.slice(0, 120);
      const formRisk = form.getAttribute('data-saydo-risk') as Risk | null;
      if (!entry.risk && entry.submits && formRisk && RISKS.includes(formRisk)) entry.risk = formRisk;
    }
    refs.set(ref, el);
    elements.push(entry);
    return ref;
  };

  const describeField = (el: Element, role: string, ref: string | null, untrusted: boolean): string => {
    const name = nameOf(el);
    const tag = ref ? `[${role} ${ref}]` : `[${role}]`;
    if (el instanceof HTMLInputElement && (el.type === 'password' || SENSITIVE_AUTOCOMPLETE.test(el.autocomplete))) {
      return `${tag} ${name}: (hidden)`;
    }
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      return `${tag} ${name}: ${el.checked ? 'checked' : 'unchecked'}`;
    }
    if (el instanceof HTMLSelectElement) {
      const options = [...el.options].map((o) => clean(o.text)).slice(0, 15).join(', ');
      return `${tag} ${name}: ${clean(el.selectedOptions[0]?.text ?? '')} (options: ${options})`;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const value = el.value ? `"${el.value.slice(0, 200)}"` : '(empty)';
      return `${tag} ${name}: ${untrusted ? `⟦${value}⟧` : value}`;
    }
    return `${tag} ${name}`;
  };

  const walk = (node: Node, untrusted: boolean) => {
    if (truncated) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.trim()) current += ` ${untrusted ? `⟦${clean(text)}⟧` : text}`;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.matches(privateSelector) || isHidden(el)) return;
    const inUntrusted = untrusted || el.hasAttribute('data-saydo-untrusted');
    const role = roleOf(el);

    if (role && OPERABLE_ROLES.has(role)) {
      const ref = addElement(el, role, inUntrusted);
      if (role === 'textbox' || role === 'combobox' || role === 'checkbox' || role === 'radio' || role === 'slider') {
        flush();
        current = describeField(el, role, ref, inUntrusted);
        flush();
        return;
      }
      const name = nameOf(el);
      current += ` ${ref ? `[${role} ${ref}]` : `[${role}]`} ${inUntrusted ? `⟦${name}⟧` : name}`;
      return;
    }

    const tag = el.tagName.toUpperCase();
    if (/^H[1-6]$/.test(tag)) {
      flush();
      current = `${'#'.repeat(Number(tag[1]))} ${textOf(el)}`;
      flush();
      return;
    }
    if (tag === 'TR') {
      flush();
      const cells = [...el.children].filter((c) => !isHidden(c)).map((c) => textOf(c));
      current = `| ${cells.join(' | ')} |`;
      if (inUntrusted) current = `⟦${current}⟧`;
      flush();
      // Operable elements inside cells still need refs.
      el.querySelectorAll('a[href],button,input,select,textarea,[role]').forEach((child) => {
        const childRole = roleOf(child);
        if (childRole && OPERABLE_ROLES.has(childRole) && !child.closest(privateSelector) && !isHidden(child)) {
          const ref = addElement(child, childRole, inUntrusted);
          if (ref) {
            current = `  [${childRole} ${ref}] ${nameOf(child)}`;
            flush();
          }
        }
      });
      return;
    }
    if (tag === 'IMG') {
      const alt = (el as HTMLImageElement).alt;
      if (alt) current += ` [image: ${clean(alt)}]`;
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) flush();
    if (tag === 'FORM') {
      const label = el.getAttribute('data-saydo') ?? el.getAttribute('toolname') ?? el.getAttribute('aria-label');
      current = `[form${label && label !== 'off' ? ` "${clean(label)}"` : ''}]`;
      flush();
    }
    if (tag === 'DIALOG') {
      current = `[dialog${el.getAttribute('aria-label') ? ` "${el.getAttribute('aria-label')}"` : ''}]`;
      flush();
    }
    for (const child of el.childNodes) walk(child, inUntrusted);
    if (block) flush();
  };

  walk(root, false);
  flush();
  return { snapshot: { text: lines.join('\n'), elements, truncated }, refs };
}

/** Briefly outline the element the assistant is operating, so the user can follow along. */
function highlight(el: Element) {
  if (!(el instanceof HTMLElement)) return;
  const previous = el.style.outline;
  el.style.outline = '2px solid #6366f1';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = previous;
  }, 1200);
}

/** Set a value the way a user would, so React and other frameworks see the change. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export type ElementAction = 'click' | 'fill' | 'select' | 'check' | 'uncheck' | 'submit';

/** Perform one action on a page element. Throws a structured error the runtime turns into a receipt. */
export async function actOnElement(el: Element, action: ElementAction, value?: string): Promise<string> {
  if (!el.isConnected) throw Object.assign(new Error('gone'), { status: 'not_found', hint: 'That element is no longer on the page.' });
  if (el instanceof HTMLElement) el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  highlight(el);
  const name = nameOf(el) || el.tagName.toLowerCase();
  switch (action) {
    case 'click':
      (el as HTMLElement).click();
      return `Clicked "${name}".`;
    case 'fill': {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el instanceof HTMLInputElement && el.type === 'password') {
          throw Object.assign(new Error('password'), { status: 'denied', hint: 'Password fields are never filled by the assistant.' });
        }
        el.focus();
        setNativeValue(el, value ?? '');
        return `Filled "${name}".`;
      }
      if ((el as HTMLElement).isContentEditable) {
        (el as HTMLElement).focus();
        el.textContent = value ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return `Filled "${name}".`;
      }
      throw Object.assign(new Error('not fillable'), { status: 'invalid_args', hint: 'That element is not a text field.' });
    }
    case 'select': {
      if (!(el instanceof HTMLSelectElement)) {
        throw Object.assign(new Error('not select'), { status: 'invalid_args', hint: 'That element is not a dropdown.' });
      }
      const wanted = (value ?? '').toLowerCase();
      const option = [...el.options].find((o) => o.value.toLowerCase() === wanted || clean(o.text).toLowerCase() === wanted);
      if (!option) throw Object.assign(new Error('no option'), { status: 'invalid_args', hint: 'No option with that value.' });
      setNativeValue(el, option.value);
      return `Selected "${clean(option.text)}" in "${name}".`;
    }
    case 'check':
    case 'uncheck': {
      const input = el as HTMLInputElement;
      const want = action === 'check';
      if (input.checked !== want) input.click();
      return `${want ? 'Checked' : 'Unchecked'} "${name}".`;
    }
    case 'submit': {
      const form = el instanceof HTMLFormElement ? el : el.closest('form');
      if (!form) throw Object.assign(new Error('no form'), { status: 'invalid_args', hint: 'That element is not in a form.' });
      form.requestSubmit();
      return `Submitted the form.`;
    }
  }
}
