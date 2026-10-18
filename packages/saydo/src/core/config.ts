import type { LanguageModel } from 'ai';
import type { Capability } from './capability';
import type { AuditEntry, AuthorizeDecision, AuthorizeRequest, EngineOptions, Pricing, Redaction, StepUpOptions, Tracer, TurnRecord, UsageEntry } from './engine';
import type { GrantStore } from './grants';
import type { LimitStore } from './limits';
import type { Planner } from './planner';
import type { ToolEntry } from './sources';
import type { ThreadStore } from './threads';
import type { Risk, SaydoUser } from './types';

/** Who is asking, and from where: passed to every per-request choice. */
export interface RequestContext {
  user: SaydoUser;
  route: string;
  request?: Request;
}

/** A how-to, policy or FAQ the assistant may answer from. */
export interface KnowledgeDoc {
  title: string;
  text: string;
  /** Pages this applies to (patterns like '/posts/[id]'); shown first there. */
  routes?: string[];
  /** Extra words people use for it ("refund", "money back"). */
  keywords?: string[];
}

/**
 * Everything you can configure, grouped by the question it answers. Only the first four are
 * common; every other group is optional and has a safe default.
 */
export interface SaydoConfig {
  // ── The essentials ─────────────────────────────────────────────────────────

  /**
   * The model: any AI SDK model; several in order of preference (failover); or a function that
   * picks per request, e.g. by plan or tenant (return a provider created with the tenant's key).
   * Without one, development uses a deterministic mock planner.
   */
  model?: LanguageModel | LanguageModel[] | ((context: RequestContext) => LanguageModel | LanguageModel[]);
  /**
   * Who is asking. Return your signed-in user `{ id, …anything }`, or null to refuse.
   * `'anonymous'` is for public apps without sign-in: each browser gets its own isolated
   * identity. Without either, production refuses actions that change data.
   */
  getUser?: ((request: Request) => SaydoUser | null | undefined | Promise<SaydoUser | null | undefined>) | 'anonymous';
  /** Where approvals live: postgresGrantStore, redisGrantStore, firestoreGrantStore, or 'memory' (one process). */
  store?: GrantStore | 'memory';
  /** Brand voice and domain hints, appended to the safety rules (never replacing them). A function picks them per request. */
  instructions?: string | ((context: RequestContext) => string | undefined);

  // ── What the assistant knows about your app ────────────────────────────────

  knowledge?: {
    /** Your app's name, as the assistant says it. */
    name?: string;
    /** A short paragraph about what the app is for and who uses it. */
    about?: string;
    /** How-tos, policies and FAQs the assistant answers "how do I…" questions from. */
    docs?: KnowledgeDoc[] | ((context: RequestContext) => KnowledgeDoc[] | Promise<KnowledgeDoc[]>);
    /**
     * Also answer from a guide Saydo builds from your pages and actions (titles, descriptions,
     * where each action lives, what needs confirmation). Default true.
     */
    guide?: boolean;
  };

  // ── What it may look at ────────────────────────────────────────────────────

  see?: {
    /** The visible page as the user sees it (headings, tables, fields). Default true. */
    page?: boolean;
    /** Mask sensitive patterns everywhere before egress: 'basic' (default), 'strict', 'none', or your function. */
    redact?: Redaction;
  };

  // ── What it must never know about ──────────────────────────────────────────

  hide?: {
    /** Pages it never sees, lists or opens (patterns; 'admin/*' hides a subtree). */
    routes?: string[];
    /** Actions it never sees or calls, by id ('billing.refund') or prefix ('admin.*'). Also hidden from outside agents. */
    actions?: string[];
    /** Form fields whose values never leave the browser, by name, id or label ('salary', 'tax-id'). */
    fields?: string[];
    /** Parts of the page it never reads, as CSS selectors (like data-saydo-private). */
    selectors?: string[];
    /** Keys of useSaydoContext data that are dropped on the server. */
    context?: string[];
  };

  // ── What it may do, and how it asks ────────────────────────────────────────

  act?: {
    /** Page elements it may operate: 'all' (default), 'annotated' (data-saydo only) or false. */
    elements?: 'all' | 'annotated' | false;
    /** Risk of clicks you did not annotate. Default 'write' (the user confirms). */
    defaultRisk?: Risk;
    /** Whether data-saydo-risk may lower an element below defaultRisk. Default true. */
    annotationsCanLowerRisk?: boolean;
    /** Confirmations per request before further ones need step-up. Default 5. */
    confirmBudget?: number;
    /** After reading untrusted content, reversible steps ask first. Default 'confirm'. */
    taint?: 'confirm' | 'off';
    /** Passkey step-up for the riskiest approvals: `webauthn({ … })`. */
    stepUp?: StepUpOptions;
    /** Central policy for every call: deny or add confirmation, never remove it (OPA, Cedar, your RBAC). */
    authorize?: (request: AuthorizeRequest) => AuthorizeDecision | Promise<AuthorizeDecision>;
    /** Let it ask a short clarifying question with clickable options instead of guessing. Default true. */
    clarify?: boolean;
  };

  // ── Abilities from elsewhere ───────────────────────────────────────────────

  /** mcp(…), aiTools(…), fromOpenAPI(…), fromTRPC(…), or plain actions. Unmapped tools are 'destructive'. */
  tools?: ToolEntry[];
  /** Extra actions added to the discovered ones. */
  capabilities?: Capability[];

  // ── Limits ─────────────────────────────────────────────────────────────────

  limits?: {
    /** Requests per user per minute. Default 30; false disables. */
    perMinute?: number | false;
    /** Daily budgets per user. */
    perDay?: { requests?: number; tokens?: number };
    /** Model steps per request. Default 6. */
    steps?: number;
    /** Above this many actions, the rest are found by search. Default 40. */
    tools?: number;
    /** Where the counters live; redisLimitStore(…) with more than one instance. */
    store?: LimitStore;
  };

  // ── Conversations ──────────────────────────────────────────────────────────

  conversations?: {
    /** Store conversations on the server (history, resume, erasure). Default: kept in the browser tab only. */
    store?: ThreadStore;
    /** Days a stored conversation lives after its last message. Default 30. */
    retentionDays?: number;
  };

  // ── Agents outside your app (MCP) ──────────────────────────────────────────

  agents?: {
    /** Identify the user behind an MCP client (a personal access token, OAuth). Required to enable MCP. */
    authenticate?: (request: Request) => SaydoUser | null | undefined | Promise<SaydoUser | null | undefined>;
    /** Gated calls from agents: 'deny' (default) or 'delegated' (the user approves in your app). */
    approvals?: 'deny' | 'delegated';
    /** Public origin for approval links. Default: the request origin. */
    appOrigin?: string;
    /** App path of the approval page. Default '/saydo/approve'. */
    approvalUrl?: string;
  };

  // ── Watching it run ────────────────────────────────────────────────────────

  observe?: {
    audit?: (entry: AuditEntry) => void;
    onUsage?: (entry: UsageEntry) => void;
    /** USD per million tokens, so usage carries costUsd. */
    pricing?: Pricing;
    /** OpenTelemetry tracer: spans per model step and per action. */
    tracer?: Tracer;
    /** Every request, for replay with replayPlanner. */
    record?: (turn: TurnRecord) => void;
    /** Recorded on audit entries and the manifest. Default VERCEL_DEPLOYMENT_ID / NEXT_DEPLOYMENT_ID. */
    deploymentId?: string;
  };

  // ── Rarely needed ──────────────────────────────────────────────────────────

  advanced?: {
    /** Your own planner (agent loop). The consent gate still applies. */
    planner?: Planner;
    /** Encrypts conversation state. Default SAYDO_SECRET, or a generated dev secret. */
    secret?: string;
    /** Find actions by meaning in large apps: `{ embed: (texts) => vectors }`. */
    search?: EngineOptions['search'];
    /** Lockfile path, or false. Default saydo.capabilities.json. */
    lockfile?: string | false;
  };
}

/** Typed helper for `saydo.config.ts`. */
export function defineConfig(config: SaydoConfig): SaydoConfig {
  return config;
}

const GROUPS = ['knowledge', 'see', 'hide', 'act', 'limits', 'conversations', 'agents', 'observe', 'advanced'] as const;

/** Later configs win, group by group (so per-route overrides keep the rest of a group). */
export function mergeConfig(...configs: Array<SaydoConfig | undefined>): SaydoConfig {
  const out: Record<string, unknown> = {};
  for (const config of configs) {
    if (!config) continue;
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) continue;
      out[key] =
        (GROUPS as readonly string[]).includes(key) && value && typeof value === 'object'
          ? { ...(out[key] as object | undefined), ...(value as object) }
          : value;
    }
  }
  return out as SaydoConfig;
}

const KNOWN = new Set(['model', 'getUser', 'store', 'instructions', 'tools', 'capabilities', ...GROUPS]);

/** Unknown top-level keys are almost always an old flat option or a typo: say where it lives now. */
export function configWarnings(config: SaydoConfig): string[] {
  const moved: Record<string, string> = {
    appName: 'knowledge.name',
    redact: 'see.redact',
    rateLimit: 'limits.perMinute',
    budget: 'limits.perDay',
    maxSteps: 'limits.steps',
    maxTools: 'limits.tools',
    threads: 'conversations.store',
    external: 'agents',
    audit: 'observe.audit',
    onUsage: 'observe.onUsage',
    pricing: 'observe.pricing',
    tracer: 'observe.tracer',
    record: 'observe.record',
    deploymentId: 'observe.deploymentId',
    planner: 'advanced.planner',
    secret: 'advanced.secret',
    search: 'advanced.search',
    lockfile: 'advanced.lockfile',
    stepUp: 'act.stepUp',
    authorize: 'act.authorize',
    confirmBudget: 'act.confirmBudget',
    taint: 'act.taint',
    anonymous: "getUser: 'anonymous'",
  };
  return Object.keys(config)
    .filter((key) => !KNOWN.has(key))
    .map((key) => (moved[key] ? `"${key}" is now ${moved[key]} in saydo.config.ts.` : `Unknown option "${key}" in saydo.config.ts.`));
}
