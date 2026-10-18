import { describe, expect, it } from 'vitest';
import { costOf, type Span, type Tracer, type UsageEntry } from '../src/core/server';
import { alice, call, client, ok, setup } from './fixtures';

function recordingTracer() {
  const spans: { name: string; attributes: Record<string, unknown>; status?: { code: number; message?: string }; ended: boolean }[] = [];
  const tracer: Tracer = {
    startSpan(name, options) {
      const record = { name, attributes: { ...options?.attributes } as Record<string, unknown>, status: undefined as { code: number; message?: string } | undefined, ended: false };
      spans.push(record);
      const span: Span = {
        setAttribute: (key, value) => (record.attributes[key] = value),
        setStatus: (status) => (record.status = status),
        end: () => (record.ended = true),
      };
      return span;
    },
  };
  return { tracer, spans };
}

describe('observability', () => {
  it('computes cost with cached input priced separately', () => {
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 0 }, { input: 3, output: 15 })).toBe(3);
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 800_000 }, { input: 3, output: 15, cachedInput: 0.3 })).toBe(0.6 + 0.24 + 1.5);
    expect(costOf({ inputTokens: 10, outputTokens: 0, cachedInputTokens: 99 }, { input: 1, output: 1, cachedInput: 0 })).toBe(0);
  });

  it('emits spans per model step and per action, and reports usage with cost', async () => {
    const { tracer, spans } = recordingTracer();
    const usage: UsageEntry[] = [];
    const { engine } = setup(
      [
        { ...call('posts_count'), usage: { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 600 } },
        { text: 'You have 2 posts.', calls: [], usage: { inputTokens: 1200, outputTokens: 20 } },
      ],
      { tracer, pricing: { input: 3, output: 15, cachedInput: 0.3 }, onUsage: (e) => usage.push(e) },
    );
    ok(await engine.handle({ type: 'message', text: 'how many posts do I have', client: client() }, alice));
    expect(spans.map((s) => s.name)).toEqual(['saydo.plan', 'saydo.execute', 'saydo.plan']);
    expect(spans.every((s) => s.ended)).toBe(true);
    expect(spans[0]!.attributes).toMatchObject({ 'saydo.step': 1, 'gen_ai.usage.input_tokens': 1000, 'saydo.calls': 1 });
    expect(spans[1]!.attributes).toMatchObject({ 'saydo.capability': 'posts.count', 'saydo.risk': 'read', 'saydo.status': 'ok' });
    expect(spans[1]!.status).toEqual({ code: 1 });
    expect(usage).toEqual([
      expect.objectContaining({ userId: 'u1', steps: 2, inputTokens: 2200, outputTokens: 70, cachedInputTokens: 600, costUsd: costOf({ inputTokens: 2200, outputTokens: 70, cachedInputTokens: 600 }, { input: 3, output: 15, cachedInput: 0.3 }) }),
    ]);
  });

  it('marks failed actions as span errors and survives a broken tracer', async () => {
    const { tracer, spans } = recordingTracer();
    const { engine } = setup([call('posts_crash'), { text: 'Sorry.', calls: [] }], { tracer });
    ok(await engine.handle({ type: 'message', text: 'crash it', client: client() }, alice));
    expect(spans.find((s) => s.name === 'saydo.execute')!.status).toEqual({ code: 2, message: 'handler_error' });

    const broken: Tracer = {
      startSpan() {
        throw new Error('exporter down');
      },
    };
    const { engine: second } = setup([call('posts_count'), { text: 'Done.', calls: [] }], { tracer: broken });
    expect((await second.handle({ type: 'message', text: 'count', client: client() }, alice)).ok).toBe(true);
  });

  it('estimates input tokens and cost in inspect, and shows the deployment in the manifest', async () => {
    const { engine } = setup(undefined, { pricing: { input: 3, output: 15 }, deploymentId: 'dpl_123' });
    const inspected = await engine.inspect(alice, client());
    expect(inspected.estimate.inputTokens).toBeGreaterThan(100);
    expect(inspected.estimate.costUsd).toBeCloseTo((inspected.estimate.inputTokens * 3) / 1e6, 6);
    expect((await engine.manifest(alice)).deploymentId).toBe('dpl_123');
  });
});
