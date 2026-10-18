import { anthropic } from '@ai-sdk/anthropic';
import { tool } from 'ai';
import { z } from 'zod';
import { defineConfig } from 'saydo/config';
import { aiTools, memoryThreadStore, mockPlanner } from 'saydo/server';
import { getUser } from '@/lib/auth';

// Any AI SDK tool (or MCP server, OpenAPI spec, tRPC router) can be plugged in.
const convertCurrency = tool({
  description: 'Convert an amount between USD, EUR and INR (demo rates)',
  inputSchema: z.object({ amount: z.number(), from: z.enum(['USD', 'EUR', 'INR']), to: z.enum(['USD', 'EUR', 'INR']) }),
  execute: async ({ amount, from, to }) => {
    const usd = { USD: 1, EUR: 1.08, INR: 0.012 };
    return { amount: Math.round((amount * usd[from]) / usd[to] * 100) / 100, currency: to };
  },
});

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

// One place for everything the assistant may use. Without an API key the demo
// runs on the deterministic mock planner, so it works anywhere (including CI).
export default defineConfig({
  appName: 'Acme Posts',
  model: hasKey ? anthropic('claude-sonnet-5-5') : undefined,
  planner: hasKey ? undefined : mockPlanner(),
  getUser,
  // Full freedom: the assistant sees the visible page and can operate any element.
  // Unannotated clicks ask first; tighten or loosen with `see` / `act`.
  see: { page: true },
  act: { elements: 'all', defaultRisk: 'write' },
  tools: [aiTools({ convertCurrency }, { risk: 'read', trusted: true })], // trusted: our own code, not a third party
  // Single-process demo. Use a durable store (Postgres, Redis or Firestore) for multiple instances.
  store: 'memory',
  // Conversation history and resume (the palette shows "History"). For production:
  // firestoreThreadStore(getFirestore()) or postgresThreadStore(pool). Remove it to keep
  // conversations in the browser tab only.
  threads: memoryThreadStore(),
  // Let outside agents (MCP) use actions marked `expose: { external: true }`:
  // external: { authenticate: (request) => userFromToken(request), approvals: 'delegated' },
});
