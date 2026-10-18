import { anthropic } from '@ai-sdk/anthropic';
import { tool } from 'ai';
import { z } from 'zod';
import { defineConfig } from 'saydo-js/config';
import { aiTools, memoryThreadStore, mockPlanner } from 'saydo-js/server';
import { APP_NAME } from '@/lib/app-name';
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

// One place for everything the assistant may use, grouped by question.
export default defineConfig({
  // The essentials.
  model: hasKey ? anthropic('claude-sonnet-5-5') : undefined,
  getUser,
  // Single-process demo. Use a durable store (Postgres, Redis or Firestore) for multiple instances.
  store: 'memory',

  // What the assistant knows about the app ("how do I…" answers come from here and from your pages and actions).
  knowledge: {
    name: APP_NAME,
    about: 'A small blog editor: draft, publish and archive posts, and manage billing and settings.',
    docs: [{ title: 'Publishing', text: 'Open a post and press Publish. Published posts are public at once.', keywords: ['go live', 'make public'] }],
  },
  // Full freedom: it sees the visible page and can operate any element. Unannotated clicks ask first.
  see: { page: true },
  act: { elements: 'all', defaultRisk: 'write' },
  // What it must never know about. Example: hide: { routes: ['/admin'], fields: ['tax-id'] }.

  tools: [aiTools({ convertCurrency }, { risk: 'read', trusted: true })], // trusted: our own code, not a third party

  // Conversation history and resume (the palette shows "History"). For production:
  // firestoreThreadStore(getFirestore()) or postgresThreadStore(pool). Remove it to keep conversations in the tab only.
  conversations: { store: memoryThreadStore() },
  // Let outside agents (MCP) use actions marked `expose: { external: true }`:
  // agents: { authenticate: (request) => userFromToken(request), approvals: 'delegated' },

  // Without an API key the demo runs on the deterministic mock planner, so it works anywhere (including CI).
  advanced: { planner: hasKey ? undefined : mockPlanner() },
});
