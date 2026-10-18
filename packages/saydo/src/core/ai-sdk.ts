import {
  generateText,
  streamText,
  jsonSchema,
  tool,
  type JSONSchema7,
  type JSONValue,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import type { Planner, PlannerInput } from './planner';
import type { HistoryItem } from './protocol';

export interface AISdkPlannerOptions {
  /**
   * Any AI SDK model, e.g. `anthropic('claude-sonnet-5-5')`. Pass several to fail over:
   * when one errors (outage, 429, timeout), the next is tried for that step.
   */
  model: LanguageModel | LanguageModel[] | ((context: NonNullable<PlannerInput['context']>) => LanguageModel | LanguageModel[]);
  maxOutputTokens?: number;
  maxRetries?: number;
  /** Mark the stable instructions as a prompt-cache breakpoint (Anthropic). Default true. */
  cache?: boolean;
  /** Extra generateText options (temperature, providerOptions, telemetry, …). */
  generateOptions?: Record<string, unknown>;
}

type AssistantPart = Extract<ModelMessage, { role: 'assistant' }>['content'] extends infer C
  ? C extends Array<infer P>
    ? P
    : never
  : never;
type ToolPart = Extract<ModelMessage, { role: 'tool' }>['content'][number];

/** Convert sealed history into AI SDK model messages (tool calls paired with results). */
export function toModelMessages(history: HistoryItem[]): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const item of history) {
    if (item.role === 'user') {
      messages.push({ role: 'user', content: item.text });
    } else if (item.role === 'assistant') {
      const content: AssistantPart[] = [];
      if (item.text) content.push({ type: 'text', text: item.text });
      for (const call of item.calls ?? []) {
        content.push({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.args });
      }
      if (content.length) messages.push({ role: 'assistant', content });
    } else {
      const part: ToolPart = {
        type: 'tool-result',
        toolCallId: item.id,
        toolName: item.name,
        // Results written by third parties are spotlighted as data, never as instructions.
        output: item.receipt.untrusted
          ? { type: 'text', value: `<untrusted>${JSON.stringify(item.receipt).slice(0, 12_000).replace(/</g, '‹').replace(/>/g, '›')}</untrusted>` }
          : { type: 'json', value: JSON.parse(JSON.stringify(item.receipt)) as JSONValue },
      };
      const last = messages.at(-1);
      if (last?.role === 'tool') last.content.push(part);
      else messages.push({ role: 'tool', content: [part] });
    }
  }
  return messages;
}

/**
 * Planner backed by any AI SDK model. Tools are declared without `execute`,
 * so the SDK never runs anything: it only proposes calls, and the engine
 * applies policy, consent and execution.
 */
export function aiSdkPlanner(options: AISdkPlannerOptions): Planner {
  return {
    name: 'ai-sdk',
    async plan(input, { signal, onText } = {}) {
      const tools: ToolSet = {};
      for (const t of input.tools) {
        tools[t.name] = tool({
          description: t.description,
          inputSchema: jsonSchema(t.inputSchema as JSONSchema7),
        });
      }
      // Stable rules first (cacheable), per-request page context after.
      const instructions = input.instructionParts
        ? [
            {
              role: 'system' as const,
              content: input.instructionParts.stable,
              ...(options.cache === false ? {} : { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }),
            },
            { role: 'system' as const, content: input.instructionParts.dynamic },
          ]
        : input.instructions;
      // Per request (tier, tenant key, route), or one fixed choice.
      const chosen = typeof options.model === 'function' ? options.model(input.context ?? { user: { id: 'unknown' }, route: '/' }) : options.model;
      const models = Array.isArray(chosen) ? chosen : [chosen];
      if (!models.length) throw new Error('[saydo] aiSdkPlanner needs at least one model.');
      const call = (model: LanguageModel) => ({
        ...(options.generateOptions as object),
        model,
        instructions,
        messages: toModelMessages(input.history),
        tools,
        toolChoice: 'auto' as const,
        maxOutputTokens: options.maxOutputTokens ?? 1024,
        maxRetries: options.maxRetries ?? 1,
        abortSignal: signal,
      });
      let lastError: unknown;
      for (const model of models) {
        if (signal?.aborted) break;
        let streamed = false;
        try {
          if (onText) {
            // Tools have no execute, so the stream ends after this one step.
            const stream = streamText(call(model));
            let text = '';
            const calls: { id: string; name: string; args: unknown }[] = [];
            let usage: { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number } } = {};
            for await (const part of stream.fullStream) {
              if (part.type === 'text-delta') {
                streamed = true;
                text += part.text;
                onText(part.text);
              } else if (part.type === 'tool-call') calls.push({ id: part.toolCallId, name: part.toolName, args: part.input });
              else if (part.type === 'finish') usage = part.totalUsage;
              else if (part.type === 'error') throw part.error;
            }
            return {
              text,
              calls,
              usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0 },
            };
          }
          const result = await generateText(call(model));
          return {
            text: result.text,
            calls: result.toolCalls.map((c) => ({ id: c.toolCallId, name: c.toolName, args: c.input })),
            usage: {
              inputTokens: result.usage.inputTokens ?? 0,
              outputTokens: result.usage.outputTokens ?? 0,
              cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
            },
          };
        } catch (error) {
          lastError = error;
          // Text already shown to the user: failing over would show a second, different reply.
          if (streamed) throw error;
        }
      }
      throw lastError ?? new Error('The request was cancelled.');
    },
  };
}
