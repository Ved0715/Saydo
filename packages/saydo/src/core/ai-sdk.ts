import {
  generateText,
  jsonSchema,
  tool,
  type JSONSchema7,
  type JSONValue,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import type { Planner } from './planner';
import type { HistoryItem } from './protocol';

export interface AISdkPlannerOptions {
  /**
   * Any AI SDK model, e.g. `anthropic('claude-sonnet-5-5')`. Pass several to fail over:
   * when one errors (outage, 429, timeout), the next is tried for that step.
   */
  model: LanguageModel | LanguageModel[];
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
        output: { type: 'json', value: JSON.parse(JSON.stringify(item.receipt)) as JSONValue },
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
    async plan(input, { signal } = {}) {
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
      const models = Array.isArray(options.model) ? options.model : [options.model];
      if (!models.length) throw new Error('[saydo] aiSdkPlanner needs at least one model.');
      let result: Awaited<ReturnType<typeof generateText>> | undefined;
      let lastError: unknown;
      for (const model of models) {
        if (signal?.aborted) break;
        try {
          result = await generateText({
            ...(options.generateOptions as object),
            model,
            instructions,
            messages: toModelMessages(input.history),
            tools,
            toolChoice: 'auto',
            maxOutputTokens: options.maxOutputTokens ?? 1024,
            maxRetries: options.maxRetries ?? 1,
            abortSignal: signal,
          });
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!result) throw lastError ?? new Error('The request was cancelled.');
      return {
        text: result.text,
        calls: result.toolCalls.map((call) => ({ id: call.toolCallId, name: call.toolName, args: call.input })),
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
        },
      };
    },
  };
}
