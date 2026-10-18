import { AskButton } from '@/components/ask-button';
import { CopyCommand } from '@/components/copy-command';
import { Playground } from '@/components/playground';

const GITHUB = 'https://github.com/Ved0715/Saydo';

const FEATURES = [
  { title: 'Works on day one', text: 'Every page is navigable with zero configuration, and a ⌘K palette works even with the model off.' },
  { title: 'Sees what users see', text: 'It reads the visible page and can use any button, link, field or form, the way a person would.' },
  { title: 'Uses your code', text: 'Server Actions, API routes, React Query, OpenAPI, tRPC and MCP tools become abilities in one line.' },
  { title: 'Safe by structure', text: 'Risk is declared on the server. Anything consequential waits for a click on a card built from the real arguments.' },
  { title: 'You decide what it knows', text: 'Describe the app, add docs, and hide pages, actions, fields or regions in one structured config.' },
  { title: 'Any model, any agent', text: 'Any AI SDK model with failover, streaming replies, and an MCP server for agents outside your app.' },
];

const STEPS: { title: string; text: string; code: string }[] = [
  { title: 'Create an app', text: 'Next.js or Vite + React Router. Without a key it runs on the demo planner.', code: 'npx create-saydo-app my-app\ncd my-app && npm run dev   # press ⌘K' },
  {
    title: 'Add your model',
    text: 'Any AI SDK provider. Put the key in .env.local; it never reaches the browser.',
    code: "// saydo.config.ts\nexport default defineConfig({\n  model: anthropic('claude-sonnet-5-5'),\n  getUser: auth,\n});",
  },
  {
    title: 'Declare an action',
    text: 'A typed function and a risk level. Saydo builds the tool, the confirm card and the receipt.',
    code: "export const archivePost = action({\n  describe: 'Archive a post',\n  input: z.object({ post: Post.ref() }),\n  risk: 'reversible',\n  handler: ({ post }) => db.archive(post.id),\n  undo: ({ post }) => db.unarchive(post.id),\n});",
  },
  {
    title: 'Decide what it knows',
    text: 'Describe the app, add docs, hide what it must never see. Every group is optional.',
    code: "knowledge: { about: 'Invoicing for agencies', docs },\nhide: { routes: ['/admin/*'], fields: ['tax-id'] },\nact: { authorize: myPolicy },",
  },
];

export default function Home() {
  return (
    <>
      <header className="nav">
        <div className="wrap nav-row">
          <a className="brand" href="#top">
            <span className="brand-dot" aria-hidden="true" />
            Saydo
          </a>
          <nav aria-label="Main">
            <a href="#playground">Playground</a>
            <a href="#guide">Guide</a>
            <a href={GITHUB} target="_blank" rel="noopener">
              GitHub
            </a>
          </nav>
          <AskButton />
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="wrap hero-inner">
            <p className="tagline">The AI-native framework for React and Next.js</p>
            <h1 tabIndex={-1}>
              Say it.
              <br />
              It&apos;s done.
            </h1>
            <p className="lede">
              Your users type what they want and your app does it: pages, forms, buttons, your server actions and APIs. Anything consequential waits for their click on a card built from the exact arguments that will run.
            </p>
            <div className="hero-cta">
              <a className="btn primary" href="#playground">
                Try it live
              </a>
              <a className="btn" href="#guide">
                Read the guide
              </a>
            </div>
            <CopyCommand command="npx create-saydo-app my-app" />
          </div>
        </section>

        <section id="playground" className="section">
          <div className="wrap">
            <div className="section-head">
              <h2 tabIndex={-1}>Try it with your own model</h2>
              <p>This page runs on Saydo. Pick a model, then ask the board below, or press ⌘K anywhere on the site.</p>
            </div>
            <Playground />
          </div>
        </section>

        <section id="guide" className="section">
          <div className="wrap">
            <div className="section-head">
              <h2 tabIndex={-1}>Get started in four steps</h2>
              <p>
                The full documentation lives in the{' '}
                <a href={`${GITHUB}#readme`} target="_blank" rel="noopener">
                  README on GitHub
                </a>
                .
              </p>
            </div>
            <ol className="steps">
              {STEPS.map((step) => (
                <li key={step.title} className="step">
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                  <pre>
                    <code>{step.code}</code>
                  </pre>
                </li>
              ))}
            </ol>
            <div className="links">
              <a href={`${GITHUB}#4-actions`} target="_blank" rel="noopener">
                Actions →
              </a>
              <a href={`${GITHUB}#2-configure-saydoconfigts`} target="_blank" rel="noopener">
                Configuration →
              </a>
              <a href={`${GITHUB}#the-safety-model`} target="_blank" rel="noopener">
                Safety model →
              </a>
              <a href={`${GITHUB}/tree/main/examples`} target="_blank" rel="noopener">
                Examples →
              </a>
            </div>
          </div>
        </section>

        <section id="features" className="section">
          <div className="wrap">
            <div className="section-head">
              <h2 tabIndex={-1}>What you get</h2>
            </div>
            <div className="features">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="feature">
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-row">
          <span>Saydo · MIT license</span>
          <nav aria-label="Footer">
            <a href={GITHUB} target="_blank" rel="noopener">
              GitHub
            </a>
            <a href={`${GITHUB}/blob/main/SPEC.md`} target="_blank" rel="noopener">
              Protocol
            </a>
            <a href={`${GITHUB}/blob/main/SECURITY.md`} target="_blank" rel="noopener">
              Security
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}
