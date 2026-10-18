/**
 * Shared types for the AI navigation layer. Everything here is serializable and
 * safe to import from both server and client code.
 */

/** How dangerous a capability is. Unspecified means 'destructive' (fail safe). */
export type Risk = 'read' | 'reversible' | 'write' | 'destructive' | 'never';

/**
 * Consent tier the server derives from risk + arguments.
 * 0 none · 1 undo · 2 confirm · 3 step-up · 4 human-only.
 */
export type Tier = 0 | 1 | 2 | 3 | 4;

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

export type ReceiptStatus =
  | 'ok'
  | 'needs_confirmation'
  | 'denied'
  | 'expired'
  | 'cancelled'
  | 'invalid_args'
  | 'not_found'
  | 'forbidden'
  | 'precondition_failed'
  | 'not_ready'
  | 'blocked'
  | 'timeout'
  | 'reload_required'
  | 'loop_detected'
  | 'error';

/**
 * What the model (and the UI) learns about an invocation. `message` is always
 * framework- or developer-authored, never a raw exception string, so handler
 * errors cannot become a second-order prompt-injection channel.
 */
export interface Receipt {
  status: ReceiptStatus;
  code?: string;
  result?: unknown;
  message?: string;
  fix?: string;
  retryable?: boolean;
  route?: string;
  undoable?: boolean;
}

/** Declarative client effects a server capability can return. */
export type Effect =
  | { type: 'navigate'; href: string; replace?: boolean; title?: string }
  | { type: 'refresh' }
  | { type: 'toast'; message: string }
  | { type: 'undo'; token: string; label: string; expiresAt: number };

export interface SaydoUser {
  id: string;
  [key: string]: unknown;
}

/** Who may see a capability or route. Everything defaults to the in-app assistant only. */
export interface Exposure {
  assistant?: boolean;
  browserAgent?: boolean;
  external?: boolean;
}

/** Structured confirmation content, rendered by the client from server-validated args. */
/** What the browser must prove for a step-up approval (for example a WebAuthn request). */
export interface StepUpChallenge {
  method: string;
  challenge: string;
  [key: string]: unknown;
}

export interface ConfirmView {
  title: string;
  danger?: boolean;
  fields: Array<{ label: string; value: string; untrusted?: boolean }>;
  /** Step-up: the user must type this exact text to approve. */
  requireTyped?: string;
  confirmLabel?: string;
}
