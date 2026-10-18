import { AskButton } from '@/components/ask-button';
import { APP_NAME } from '@/lib/app-name';

const GITHUB = 'https://github.com/Ved0715/Saydo';

const HOW = [
  { title: 'It sees the page', text: 'The assistant reads what the user sees and can follow links, fill fields and press buttons, like a person would.' },
  { title: 'You decide what it may do', text: 'Each action has a risk level. Reads run at once; anything that changes data waits for the user’s click on a card.' },
  { title: 'Keys stay on your server', text: 'The model runs behind /api/saydo with any AI SDK provider. Nothing secret reaches the browser.' },
];

const STEPS = [
  {
    title: 'Add your model',
    text: 'Without a key the app runs on a built-in mock planner. For a real model:',
    code: '# .env.local\nANTHROPIC_API_KEY=sk-ant-…',
  },
  {
    title: 'Tell it who the user is',
    text: 'In saydo.config.ts, replace the anonymous user with your auth.',
    code: "getUser: async () => {\n  const session = await auth();\n  return session ? { id: session.user.id } : null;\n},",
  },
  {
    title: 'Add an action',
    text: 'A file in capabilities/. The file path becomes its id.',
    code: "// capabilities/notes/create.ts\nexport default action({\n  describe: 'Create a note',\n  input: z.object({ text: z.string() }),\n  risk: 'write', // the user confirms first\n  handler: ({ text }, ctx) => db.notes.create(text, ctx.user.id),\n});",
  },
  {
    title: 'Hide what it must not see',
    text: 'One attribute, or a list in saydo.config.ts.',
    code: '<div data-saydo-private>•••• 4242</div>\n\n// saydo.config.ts\nhide: { routes: [\'/admin/*\'], fields: [\'tax-id\'] },',
  },
];

const LINKS = [
  { label: 'Documentation', href: `${GITHUB}#readme` },
  { label: 'Actions', href: `${GITHUB}#4-actions` },
  { label: 'Configuration', href: `${GITHUB}#2-configure-saydoconfigts` },
  { label: 'Safety model', href: `${GITHUB}#the-safety-model` },
  { label: 'Full example app', href: `${GITHUB}/tree/main/examples/next-demo` },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Saydo is running</p>
        <h1 className="hero-title" tabIndex={-1}>
          {APP_NAME} is ready for AI.
        </h1>
        <p className="hero-sub">
          Your users press <kbd>⌘K</kbd> and say what they want. Saydo opens pages, fills forms and runs your actions, and asks before anything
          changes data.
        </p>
        <div className="hero-actions">
          <AskButton primary />
          <a className="button" href={`${GITHUB}#readme`}>
            Read the docs
          </a>
        </div>
      </section>

      <section className="section" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <div className="grid">
          {HOW.map((item) => (
            <div key={item.title} className="card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="setup-title">
        <h2 id="setup-title">Set it up</h2>
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
      </section>

      <section className="section" aria-labelledby="more-title">
        <h2 id="more-title">Learn more</h2>
        <nav className="links" aria-labelledby="more-title">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label} →
            </a>
          ))}
        </nav>
        <p className="muted">
          Edit <code>app/page.tsx</code> to start building.
        </p>
      </section>
    </>
  );
}
