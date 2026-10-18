import { searchRoutes, type NavTarget } from './fastpath';
import type { HistoryItem, PageElement, PlannerCall } from './protocol';

export interface PlannerTool {
  name: string;
  description: string;
  /** JSON Schema (draft-07) for the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface PageInfo {
  route: string;
  title?: string;
  /** Entities visible on the current page, already resolved to handles. */
  entities: Array<{ handle: string; type: string; label: string }>;
  /** The visible page outline, when the developer allows page reading. */
  screen?: string;
  /** Elements the assistant may operate on this screen. */
  elements?: PageElement[];
}

export interface PlannerInput {
  instructions: string;
  /** The same instructions split for prompt caching: rules that rarely change, then per-request context. */
  instructionParts?: { stable: string; dynamic: string };
  history: HistoryItem[];
  tools: PlannerTool[];
  page: PageInfo;
  /** Structured extras for deterministic planners; model planners ignore them. */
  hints: { routes: NavTarget[] };
}

export interface PlannerOutput {
  text?: string;
  calls: PlannerCall[];
  usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number };
}

/**
 * The only thing that talks to a model. The engine owns the loop, the policy
 * and execution; a planner just proposes the next text and tool calls.
 */
export interface Planner {
  readonly name: string;
  plan(input: PlannerInput, options?: { signal?: AbortSignal }): Promise<PlannerOutput>;
}

type ScriptStep = PlannerOutput | ((input: PlannerInput) => PlannerOutput);

let callCounter = 0;
const callId = () => `call_${Date.now().toString(36)}_${(callCounter++).toString(36)}`;

/**
 * Deterministic planner for CI, demos without an API key, and adversarial
 * tests. With a `script`, it replays exactly those outputs (use this to model a
 * fully compromised model). Without one, it uses simple keyword heuristics.
 */
export function mockPlanner(options: { script?: ScriptStep[] } = {}): Planner {
  let step = 0;
  return {
    name: 'mock',
    async plan(input) {
      if (options.script) {
        const next = options.script[Math.min(step++, options.script.length - 1)];
        const output = typeof next === 'function' ? next(input) : next;
        return output ?? { text: 'Done.', calls: [] };
      }
      return heuristic(input);
    },
  };
}

const NAV_RE = /\b(go to|goto|open|take me to|navigate to|show me|show|visit|bring me to)\b/;

function heuristic(input: PlannerInput): PlannerOutput {
  const last = input.history.at(-1);
  if (!last) return { text: 'How can I help?', calls: [] };
  if (last.role === 'tool') return { text: summarize(input.history), calls: [] };
  if (last.role !== 'user') return { text: 'Done.', calls: [] };

  const text = last.text.toLowerCase();
  const tools = new Map(input.tools.map((t) => [t.name, t]));
  const call = (name: string, args: unknown): PlannerOutput => ({ calls: [{ id: callId(), name, args }] });
  const nav = (): PlannerOutput | undefined => {
    if (!tools.has('nav_goto')) return undefined;
    const [best] = searchRoutes(text.replace(NAV_RE, ''), input.hints.routes, 1);
    if (best && best.score >= 0.5 && !best.route.pattern.includes('[')) {
      return call('nav_goto', { route: best.route.pattern });
    }
    return undefined;
  };

  // Page verbs operate visible elements: "click Publish", "fill Title with Q4", "check Remember me".
  const elements = input.page.elements ?? [];
  if (tools.has('page_act') && elements.length) {
    const find = (label: string, roles?: string[]) => {
      const wanted = label.trim().toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/\s+(button|link|field|box|checkbox|dropdown)$/, '');
      const pool = elements.filter((e) => !roles || roles.includes(e.role));
      return pool.find((e) => e.name.toLowerCase() === wanted) ?? pool.find((e) => e.name.toLowerCase().includes(wanted));
    };
    // Match on the original text so the typed value keeps its capitalization.
    const original = last.text.trim();
    const fillWith = /^(?:fill(?: in)?|set)\s+(?:the\s+)?(.+?)\s+(?:with|to)\s+["“']?(.+?)["”']?$/i.exec(original);
    const typeInto = /^(?:type|enter|write)\s+["“']?(.+?)["”']?\s+(?:in|into)\s+(?:the\s+)?(.+)$/i.exec(original);
    const fill = fillWith ? { label: fillWith[1]!, value: fillWith[2]! } : typeInto ? { label: typeInto[2]!, value: typeInto[1]! } : null;
    if (fill) {
      const el = find(fill.label, ['textbox']);
      if (el) return call('page_act', { ref: el.ref, action: 'fill', value: fill.value });
    }
    const pick = /^(?:select|choose|pick)\s+["“']?(.+?)["”']?\s+(?:in|for|from)\s+(?:the\s+)?(.+)$/.exec(text);
    if (pick) {
      const el = find(pick[2]!, ['combobox']);
      if (el) return call('page_act', { ref: el.ref, action: 'select', value: pick[1] });
    }
    const tick = /^(check|tick|uncheck|untick)\s+(.+)$/.exec(text);
    if (tick) {
      const el = find(tick[2]!, ['checkbox', 'switch', 'radio']);
      if (el) return call('page_act', { ref: el.ref, action: tick[1]!.startsWith('un') ? 'uncheck' : 'check' });
    }
    if (/^submit\b/.test(text)) {
      const el = elements.find((e) => e.submits);
      if (el) return call('page_act', { ref: el.ref, action: 'click' });
    }
    const click = /^(?:click|press|tap|hit)\s+(?:on\s+)?(.+)$/.exec(text);
    if (click) {
      const el = find(click[1]!);
      if (el) return call('page_act', { ref: el.ref, action: 'click' });
    }
  }

  // "go to new post" is navigation, not creation.
  if (/^(please\s+)?(go to|goto|take me to|navigate to|open|show me|visit)\b/.test(text)) {
    const navigation = nav();
    if (navigation) return navigation;
  }

  // UI actions: match on words from their descriptions.
  const ui = input.tools
    .filter((t) => t.name.startsWith('ui_'))
    .find((t) => keywords(t.description).some((w) => text.includes(w)));

  const verb = ['delete', 'remove', 'archive', 'restore', 'publish', 'count', 'list', 'refund', 'create'].find((v) =>
    text.includes(v === 'count' ? 'how many' : v),
  ) ?? (/\b(start|new|add|write)\b/.test(text) ? 'create' : undefined);

  if (verb) {
    const stem = verb === 'remove' ? 'delete' : verb;
    const candidates = input.tools.filter((t) => !t.name.startsWith('ui_') && t.name.includes(stem));
    // Prefer the tool about what the user named or what is on the page ("delete this post" → posts_delete).
    const nouns = [...input.page.entities.map((e) => e.type), ...text.split(/[^a-z]+/).filter((w) => w.length > 2)];
    const tool = candidates.find((t) => nouns.some((n) => t.name.startsWith(n))) ?? candidates[0];
    if (tool) {
      const args: Record<string, unknown> = {};
      type Prop = { description?: string; type?: string; items?: { description?: string } };
      const props = (tool.inputSchema.properties ?? {}) as Record<string, Prop>;
      for (const [key, prop] of Object.entries(props)) {
        // Entity refs carry "handle" in their description (on `items` for arrays).
        if (prop.description?.includes('handle') || prop.items?.description?.includes('handle')) {
          const entity = input.page.entities.find((e) => key.startsWith(e.type)) ?? input.page.entities[0];
          if (!entity) return { text: 'Which item do you mean? Open it first or tell me its name.', calls: [] };
          args[key] = prop.type === 'array' ? [entity.handle] : entity.handle;
        }
      }
      const titled = /(?:titled|called|named)\s+["“']?(.+?)["”']?\s*$/i.exec(last.text);
      if (titled && 'title' in props) args.title = titled[1];
      return call(tool.name, args);
    }
  }

  if (ui) return call(ui.name, fillArgs(ui, last.text));
  // A tool named in the request ("send feedback saying …" → feedback).
  const named = input.tools.find(
    (t) => !BUILT_IN.has(t.name) && !t.name.startsWith('ui_') && t.name.split(/[_.]/).some((part) => part.length > 3 && text.includes(part)),
  );
  if (named) return call(named.name, fillArgs(named, last.text));
  const navigation = nav();
  if (navigation) return navigation;
  return { text: 'I can open pages and run app actions. Try "go to billing".', calls: [] };
}

const BUILT_IN = new Set(['nav_goto', 'page_act', 'entities_find', 'find_capability']);

/** Best-effort arguments from the request text: enum values mentioned, and free text after "saying"/"that"/":". */
function fillArgs(tool: PlannerTool, original: string): Record<string, unknown> {
  const props = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
  const required = (tool.inputSchema.required ?? []) as string[];
  const lower = original.toLowerCase();
  const args: Record<string, unknown> = {};
  const freeText = /(?:saying|that says|that|:)\s+["“']?(.+?)["”']?$/i.exec(original)?.[1];
  for (const [key, prop] of Object.entries(props)) {
    if (prop.enum) {
      const hit = prop.enum.find((v) => typeof v === 'string' && lower.includes(v.toLowerCase()));
      if (hit !== undefined) args[key] = hit;
    } else if (prop.type === 'string' && required.includes(key) && args[key] === undefined && freeText) {
      args[key] = freeText;
    }
  }
  return args;
}

function keywords(description: string): string[] {
  return description
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 4 && !['dialog', 'which', 'there', 'their', 'about'].includes(w));
}

function summarize(history: HistoryItem[]): string {
  const results: Array<Extract<HistoryItem, { role: 'tool' }>> = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i]!;
    if (item.role !== 'tool') break;
    results.unshift(item);
  }
  return (
    results
      .map(({ receipt }) => {
        switch (receipt.status) {
          case 'ok':
            return receipt.message ?? 'Done.';
          case 'denied':
            return 'Okay, I did not do that.';
          case 'expired':
            return 'That confirmation expired.';
          default:
            return receipt.message ?? `That did not work (${receipt.status}).`;
        }
      })
      .join(' ') || 'Done.'
  );
}

/**
 * Replays recorded model answers (from the engine's `record` option) in order, so a
 * production incident becomes a deterministic test. With `strict`, it throws when the
 * app now offers the model different tools than when the turn was recorded.
 */
export function replayPlanner(
  records: { steps: { input: { tools: { name: string }[] }; output: PlannerOutput }[] } | { steps: { input: { tools: { name: string }[] }; output: PlannerOutput }[] }[],
  options: { strict?: boolean } = {},
): Planner {
  const steps = (Array.isArray(records) ? records : [records]).flatMap((r) => r.steps);
  let index = 0;
  return {
    name: 'replay',
    async plan(input) {
      const step = steps[index++];
      if (!step) throw new Error(`[saydo] replay: the app asked the model ${index} times; the recording has ${steps.length} steps.`);
      if (options.strict) {
        const now = input.tools.map((t) => t.name).sort().join(',');
        const then = step.input.tools.map((t) => t.name).sort().join(',');
        if (now !== then) throw new Error(`[saydo] replay drift at step ${index}: tools were [${then}], now [${now}].`);
      }
      return structuredClone(step.output);
    },
  };
}
