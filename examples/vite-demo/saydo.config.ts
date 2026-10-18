import { anthropic } from '@ai-sdk/anthropic';
import { defineConfig } from 'saydo/config';
import { mockPlanner } from 'saydo/server';

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

export default defineConfig({
  appName: 'Saydo React demo',
  model: hasKey ? anthropic('claude-sonnet-5-5') : undefined,
  planner: hasKey ? undefined : mockPlanner(),
  store: 'memory',
});
