import { z } from 'zod';
import { defineCapability, type Capability, type CapabilityContext } from './capability';
import { findRefFields } from './entity';
import { CapabilityError } from './fixes';
import type { Effect, Exposure, Risk } from './types';

const RANK: Record<Risk, number> = { read: 0, reversible: 1, write: 2, destructive: 3, never: 4 };

export interface WorkflowStep<I> {
  /** A server action (a capability with a handler). */
  run: Capability;
  /** This step's input, from the workflow input and the results of earlier steps (in order). */
  input: (input: I, results: unknown[]) => unknown;
  /** Skip this step when it returns false. */
  when?: (input: I, results: unknown[]) => boolean;
}

export interface WorkflowDefinition<S extends z.ZodObject> {
  id?: string;
  describe: string;
  title?: string;
  input: S;
  steps: WorkflowStep<z.output<S>>[];
  /** Raise the risk above the riskiest step (it can never go lower). */
  risk?: Risk;
  /** Undo for the whole workflow; without it, a workflow of reversible steps confirms like a write. */
  undo?: (input: z.output<S>, ctx: CapabilityContext) => unknown;
  version?: number;
  expose?: Exposure;
  scope?: { routes?: string[] };
  can?: (user: CapabilityContext['user']) => boolean | Promise<boolean>;
}

/**
 * Compose server actions into one named action with one consent decision. The model
 * fills the input; the steps, their order and their data flow are yours, never the
 * model's. If a step fails, completed steps that have `undo` are undone in reverse.
 *
 *   export const publishAndNotify = workflow({
 *     describe: 'Publish a post and email its subscribers',
 *     input: z.object({ post: Post.ref() }),
 *     steps: [
 *       { run: publishPost, input: ({ post }) => ({ post }) },
 *       { run: notifySubscribers, input: ({ post }) => ({ postId: post.id }) },
 *     ],
 *   });
 */
export function workflow<S extends z.ZodObject>(definition: WorkflowDefinition<S>): Capability<S> {
  const name = definition.id ?? definition.describe;
  if (!definition.steps.length) throw new Error(`workflow("${name}"): add at least one step.`);
  for (const step of definition.steps) {
    if (!step.run || typeof step.run.handler !== 'function') {
      throw new Error(`workflow("${name}"): every step must be a server action with a handler (fix: client capabilities cannot be steps).`);
    }
    if (step.run.resolvedRisk === 'never') {
      throw new Error(`workflow("${name}"): step "${step.run.id || step.run.describe}" is risk 'never' and can never run for the assistant.`);
    }
  }
  let risk = definition.steps.map((s) => s.run.resolvedRisk).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'read' as Risk);
  if (definition.risk && RANK[definition.risk] > RANK[risk]) risk = definition.risk;
  if (risk === 'reversible' && !definition.undo) risk = 'write';

  const handler = async (input: z.output<S>, ctx: CapabilityContext) => {
    const results: unknown[] = [];
    const effects: Effect[] = [];
    const done: { step: WorkflowStep<z.output<S>>; input: unknown }[] = [];
    for (const [index, step] of definition.steps.entries()) {
      if (step.when && !step.when(input, results)) {
        results.push(undefined);
        continue;
      }
      const title = step.run.title ?? step.run.describe;
      try {
        const stepInput = checkStepInput(step.run, step.input(input, results));
        const output = await step.run.handler!(stepInput as never, { ...ctx, invocationId: `${ctx.invocationId}:${index}` });
        const structured =
          output && typeof output === 'object' && !Array.isArray(output) && Object.keys(output).every((k) => k === 'result' || k === 'effects');
        results.push(structured ? (output as { result?: unknown }).result : output);
        if (structured && Array.isArray((output as { effects?: unknown }).effects)) effects.push(...((output as { effects: Effect[] }).effects));
        done.push({ step, input: stepInput });
      } catch (error) {
        const kept: string[] = [];
        for (const completed of done.reverse()) {
          const completedTitle = completed.step.run.title ?? completed.step.run.describe;
          if (!completed.step.run.undo) {
            kept.push(completedTitle);
            continue;
          }
          try {
            await completed.step.run.undo(completed.input as never, ctx);
          } catch {
            kept.push(completedTitle);
          }
        }
        const reason = error instanceof CapabilityError ? error.hint : 'it failed on the server';
        const after = done.length === 0 ? '' : kept.length ? ` These earlier steps stay done: ${kept.reverse().join(', ')}.` : ' Earlier steps were undone.';
        throw new CapabilityError(error instanceof CapabilityError ? error.status : 'error', `Step ${index + 1} (${title}) did not complete: ${reason}.${after}`.slice(0, 300), 'workflow_step_failed');
      }
    }
    return { result: { steps: results }, effects };
  };

  const capability = defineCapability({
    id: definition.id,
    describe: definition.describe,
    title: definition.title,
    input: definition.input,
    version: definition.version,
    expose: definition.expose,
    scope: definition.scope,
    can: async (user: CapabilityContext['user']) => {
      if (definition.can && !(await definition.can(user))) return false;
      for (const step of definition.steps) if (step.run.can && !(await step.run.can(user))) return false;
      return true;
    },
    ...(risk === 'reversible' ? { risk, handler, undo: definition.undo! } : { risk: risk as Exclude<Risk, 'reversible'>, handler }),
  } as never) as Capability<S>;
  return Object.assign(capability, { steps: definition.steps.map((s) => s.run.title ?? s.run.describe) });
}

/** Validate a step's plain fields with its own schema; entity fields are already resolved records. */
function checkStepInput(cap: Capability, value: unknown): unknown {
  if (!(cap.input instanceof z.ZodObject) || cap.inputJsonSchema) return value;
  const refKeys = findRefFields(cap.input).map((f) => f.key);
  const plain = refKeys.length ? cap.input.omit(Object.fromEntries(refKeys.map((k) => [k, true])) as never) : cap.input;
  const parsed = (plain as z.ZodObject).safeParse(value);
  if (!parsed.success) throw new CapabilityError('invalid_args', `the step input is invalid (${parsed.error.issues[0]?.message ?? 'check the workflow'})`, 'workflow_input');
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return { ...(parsed.data as object), ...Object.fromEntries(refKeys.filter((k) => k in record).map((k) => [k, record[k]])) };
}
