import { anthropic } from '@ai-sdk/anthropic';
import { defineConfig } from 'saydo-js/config';
import { mockPlanner } from 'saydo-js/server';
import { APP_NAME } from '@/lib/app-name';

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

export default defineConfig({
  // Any AI SDK model works: openai('gpt-5'), google('gemini-3-pro'), or several for failover.
  model: hasKey ? anthropic('claude-sonnet-5-5') : undefined,
  // Replace with your auth: (request) => ({ id: session.user.id }). 'anonymous' gives each browser its own identity.
  getUser: 'anonymous',
  // One process. Use postgresGrantStore, redisGrantStore or firestoreGrantStore with more than one instance.
  store: 'memory',

  // What the assistant knows. "How do I…" questions are answered from here and from your pages and actions.
  knowledge: {
    name: APP_NAME,
    about: 'A new app built with Saydo. Its home page explains how Saydo works and how to set it up.',
    docs: [
      { title: 'Use a real model', text: 'Put ANTHROPIC_API_KEY in .env.local, or set `model` in saydo.config.ts to any AI SDK model.', keywords: ['api key', 'openai', 'gemini', 'llm'] },
      { title: 'Add an action', text: 'Create a file in capabilities/ that exports action({ describe, input, risk, handler }). The file path becomes its id.', keywords: ['tool', 'capability', 'function'] },
      { title: 'Hide something', text: 'Add data-saydo-private to an element, or list routes, actions and fields under `hide` in saydo.config.ts.', keywords: ['private', 'secret', 'hide'] },
    ],
  },

  // Without an API key the app runs on the deterministic mock planner, so it works anywhere (including CI).
  advanced: { planner: hasKey ? undefined : mockPlanner() },
});
