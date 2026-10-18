import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { defineConfig } from 'saydo/config';
import { aiSdkPlanner, mockPlanner, type Planner, type PlannerOutput } from 'saydo/server';

const demo = mockPlanner();

/** Turn provider errors into a plain answer, so a mistyped key never looks like an outage. */
function explain(error: unknown, provider: string): PlannerOutput {
  const status = (error as { statusCode?: number; status?: number }).statusCode ?? (error as { status?: number }).status;
  const name = provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const text =
    status === 401 || status === 403
      ? `${name} rejected the API key. Check it in the playground panel and try again.`
      : status === 404
        ? `${name} does not know that model id. Check the model field in the playground panel.`
        : status === 429
          ? `${name} is rate-limiting your account right now. Wait a moment, or try the built-in demo planner.`
          : `${name} could not answer (${status ?? 'network error'}). Try again, or switch to the built-in demo planner.`;
  return { text, calls: [] };
}

/**
 * The playground lets visitors bring their own key. It arrives in a header with each request,
 * is used for that request only, and is never stored or logged. Without one, the site uses
 * its own key if the deployment set one, and otherwise the built-in deterministic planner.
 */
const playground: Planner = {
  name: 'playground',
  async plan(input, options) {
    const headers = options?.request?.headers;
    const visitorKey = headers?.get('x-saydo-key')?.trim();
    const provider = headers?.get('x-saydo-provider') === 'openai' ? 'openai' : 'anthropic';
    const model = headers?.get('x-saydo-model')?.trim().slice(0, 80);
    const key = visitorKey || (provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
    if (!key || headers?.get('x-saydo-provider') === 'demo') return demo.plan(input, options);
    const languageModel =
      provider === 'openai' ? createOpenAI({ apiKey: key })(model || 'gpt-5-mini') : createAnthropic({ apiKey: key })(model || 'claude-haiku-5-5');
    try {
      return await aiSdkPlanner({ model: languageModel, maxRetries: 0, maxOutputTokens: 600 }).plan(input, options);
    } catch (error) {
      return explain(error, provider);
    }
  },
};

export default defineConfig({
  // Public site without sign-in: each visitor gets an isolated identity.
  getUser: 'anonymous',
  // Single instance is enough for the site; set a Redis or Firestore store if you scale it out.
  store: 'memory',
  instructions: 'Visitors are developers trying Saydo. Help them use the playground board, and point them to the guide or GitHub for details.',
  knowledge: {
    name: 'the Saydo website',
    about: 'Saydo is an AI-native framework for React and Next.js. This site has a playground board (a launch checklist) and a getting-started guide.',
    docs: [
      { title: 'Install Saydo', text: 'Run npx create-saydo-app my-app, then npm run dev and press Cmd+K. In an existing app, run npx saydo init.', keywords: ['start', 'setup', 'create', 'new app'] },
      { title: 'Use your own model', text: 'Pick a provider in the playground panel and paste your API key. It is sent only with your requests and never stored.', keywords: ['api key', 'llm', 'anthropic', 'openai'] },
      { title: 'Read the docs', text: 'The full documentation is the README on GitHub: github.com/Ved0715/Saydo.', keywords: ['documentation', 'github', 'readme'] },
    ],
  },
  // Free demo turns are cheap, but keep any server-side key from being spent by one visitor.
  limits: { perDay: { requests: 200 } },
  advanced: { planner: playground },
});
