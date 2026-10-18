import type { ConfirmView, Effect, Receipt, ReceiptStatus, Risk, StepUpChallenge } from './types';

/** A UI-only action registered by a mounted component via `useAction`. Always tier 0. */
export interface UIActionDescriptor {
  id: string;
  describe: string;
  inputSchema?: Record<string, unknown>;
}

/** One element the user could operate, as read from the visible page. */
export interface PageElement {
  /** Short ref valid for one snapshot, e.g. "e4". */
  ref: string;
  role: string;
  /** Accessible name (label, text, aria-label). */
  name: string;
  actions: Array<'click' | 'fill' | 'select' | 'check' | 'uncheck' | 'submit'>;
  /** From data-saydo="…": what the developer says it does. */
  describe?: string;
  /** From data-saydo-risk: the developer's risk for this element. */
  risk?: Risk;
  /** A field or control inside a form that is not the submit button. */
  inForm?: boolean;
  /** A submit button. */
  submits?: boolean;
  form?: string;
  href?: string;
  external?: boolean;
  /** Nearby row/card text, to tell apart repeated buttons ("Delete" in which row). */
  context?: string;
  /** Non-sensitive values a submit would send, shown on the confirm card. */
  formValues?: Record<string, string>;
}

/** The visible page, as the user sees it. Always treated as untrusted data. */
export interface PageSnapshot {
  text: string;
  elements: PageElement[];
  truncated?: boolean;
}

/** Facts the client reports each turn. None of it can raise or lower a consent tier set by the server. */
export interface ClientContext {
  /** Current pathname (+ search). */
  route: string;
  tabId: string;
  /** Ids of client capabilities and UI actions mounted right now. */
  mounted: string[];
  uiActions: UIActionDescriptor[];
  /** Small app context from `useSaydoContext`. Treated as untrusted data. */
  context?: Record<string, unknown>;
  /** What is on screen right now (when the developer allows page reading). */
  page?: PageSnapshot;
  /** Set while the page has unsaved changes (useSaydoGuard); AI navigation is then refused. */
  guard?: string;
  manifestHash?: string;
  /** The user's language (BCP 47, e.g. 'de-CH'); the assistant replies in it. */
  locale?: string;
}

/** A stored conversation, as listed in the history panel. */
export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** One line of a stored conversation: what the user saw. */
export interface TranscriptEntry {
  /** Order within the conversation, assigned by the engine (monotonic across instances). */
  seq?: number;
  at: number;
  role: 'user' | 'assistant' | 'action';
  text: string;
  status?: ReceiptStatus;
  capability?: string;
  /** Clarifying questions: the options that were offered. */
  options?: string[];
}

/** Every request may carry a requestId; a retry with the same id returns the stored response instead of re-running. */
export type TurnRequest = (
  | { type: 'message'; text: string; state?: string; client: ClientContext }
  | { type: 'receipt'; state: string; toolCallId: string; receipt: Receipt; client: ClientContext }
  | {
      type: 'approve';
      state: string;
      grantId: string;
      approved: boolean;
      /** Step-up text typed by the user. */
      typed?: string;
      /** Client attests the approval came from a trusted (isTrusted) input event. */
      trusted?: boolean;
      /** Step-up proof (for example a WebAuthn assertion). */
      proof?: unknown;
      client: ClientContext;
    }
  | { type: 'undo'; state?: string; token: string; client: ClientContext }
) & { requestId?: string };

/** Things the assistant UI shows for this request. */
export type DisplayEvent =
  | { type: 'assistant'; text: string }
  /** A clarifying question with options the user can click (their answer is the next message). */
  | { type: 'question'; question: string; options: string[] }
  | { type: 'action'; capability: string; title: string; status: ReceiptStatus; message?: string };

export type PendingAction =
  | {
      type: 'dispatch';
      toolCallId: string;
      kind: 'capability' | 'ui' | 'element';
      target: string;
      args: unknown;
      /** Navigate here first and wait for `target` to mount. */
      entry?: string;
      /** Grant token for gated client capabilities; `withGrant` consumes it. */
      grant?: string;
    }
  | {
      type: 'confirm';
      toolCallId: string;
      grantId: string;
      capability: string;
      view: ConfirmView;
      tier: number;
      expiresAt: number;
      /** Several actions approved together; `view` summarizes them. */
      batch?: Array<{ grantId: string; capability: string; view: ConfirmView; tier: number }>;
      /** The approval needs a passkey (or other step-up) before the server accepts it. */
      stepUp?: StepUpChallenge;
      /** Step-up is required but this user has no passkey yet. */
      stepUpMissing?: boolean;
    };

export interface TurnResponse {
  ok: true;
  /** Sealed thread state; send it back with the next request. */
  state: string;
  events: DisplayEvent[];
  effects: Effect[];
  pending?: PendingAction;
  done: boolean;
  /** The conversation id, when conversations are stored on the server. */
  threadId?: string;
}

export interface TurnError {
  ok: false;
  status: ReceiptStatus;
  message: string;
  fix: string;
  /** Machine-readable cause, e.g. 'planner_unavailable', 'in_progress'. */
  code?: string;
}

export type TurnResult = TurnResponse | TurnError;

export interface ManifestRoute {
  pattern: string;
  title: string;
  aliases?: string[];
}

/** Per-user slice of the manifest, served by `GET` on the handler. */
export interface ClientSettings {
  /** Send the visible page with each turn. */
  page: boolean;
  /** Which page elements the assistant may operate. */
  elements: 'all' | 'annotated' | 'none';
  /** Conversations are stored on the server (history and resume are available). */
  history?: boolean;
  /** Form fields (name, id or label) whose values never leave the browser. */
  privateFields?: string[];
  /** Page regions (CSS selectors) the assistant never reads. */
  privateSelectors?: string[];
}

/** An action exposed to agents (MCP clients, WebMCP browser agents). */
export interface AgentTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  risk: Risk;
}

/** A gated agent call, waiting for the user to approve in the app. */
export interface DelegatedApproval {
  grantId: string;
  capability: string;
  view: ConfirmView;
  tier: number;
  expiresAt: number;
  /** Where the user approves (relative to the app origin). */
  url: string;
  stepUp?: StepUpChallenge;
  stepUpMissing?: boolean;
}

export type InvokeResult =
  | { ok: true; status: ReceiptStatus; receipt: Receipt; undo?: string }
  | { ok: true; status: 'needs_approval'; approval: DelegatedApproval }
  | TurnError;

export interface GrantStatus {
  ok: true;
  state: 'pending' | 'approved' | 'denied' | 'expired';
  capability: string;
  view?: ConfirmView;
  tier: number;
  expiresAt: number;
  stepUp?: StepUpChallenge;
  stepUpMissing?: boolean;
  receipt?: Receipt;
  origin?: 'external' | 'browser-agent';
}

export interface ClientManifest {
  manifestHash: string;
  routes: ManifestRoute[];
  settings: ClientSettings;
  /** Actions exposed to in-page browser agents (WebMCP), when any. */
  agentTools?: AgentTool[];
  /** Protocol version; unknown fields in any message MUST be ignored. */
  protocolVersion?: string;
  /** The server deployment, for skew diagnostics. */
  deploymentId?: string;
}

export interface PlannerCall {
  id: string;
  name: string;
  args: unknown;
}

/** Conversation history as stored inside the sealed thread state. */
export type HistoryItem =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; calls?: PlannerCall[] }
  | { role: 'tool'; id: string; name: string; receipt: Receipt };
