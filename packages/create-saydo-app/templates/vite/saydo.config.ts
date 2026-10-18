import { anthropic } from '@ai-sdk/anthropic';
import { defineConfig } from 'saydo-js/config';
import { mockPlanner } from 'saydo-js/server';

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

export default defineConfig({
  model: hasKey ? anthropic('claude-sonnet-5-5') : undefined,
  // No sign-in in this demo: each browser gets its own isolated anonymous identity.
  getUser: 'anonymous',
  store: 'memory',
  knowledge: { name: 'Saydo React demo' },
  // Without an API key the demo uses the deterministic mock planner.
  advanced: { planner: hasKey ? undefined : mockPlanner() },
});
