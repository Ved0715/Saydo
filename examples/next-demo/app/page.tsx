import { AskButton } from '@/components/ask-button';
import { TryIt, type Example } from '@/components/try-it';
import { APP_NAME } from '@/lib/app-name';

const DOCS = 'https://github.com/Ved0715/Saydo#readme';

const EXAMPLES: Example[] = [
  { say: 'take me to billing', badge: 'instant', tone: 'instant', what: 'Every page is navigable with no code. Answered locally, without a model call.' },
  { say: 'start a new post titled Launch Notes', badge: 'asks first', tone: 'asks', what: 'A declared action in capabilities/posts.ts. You confirm a card, then land on the draft.' },
  { say: 'how many posts do I have?', badge: 'instant', tone: 'instant', what: 'A read action: it runs at once and the assistant answers from the result.' },
  { say: 'what can you do here?', badge: 'instant', tone: 'instant', what: 'Answers come from your pages, actions and the knowledge in saydo.config.ts.' },
  { say: 'show unpaid invoices', badge: 'instant', tone: 'instant', what: 'Typed URL state from app/billing/nav.ts. Needs a real model.' },
  { say: 'convert 49 USD to INR', badge: 'instant', tone: 'instant', what: 'An AI SDK tool plugged in with one line in saydo.config.ts. Needs a real model.' },
];

const FILES = [
  { path: 'saydo.config.ts', text: 'The model, who the user is, and what the assistant may see, know and do.' },
  { path: 'capabilities/', text: 'Actions the assistant can take. A typed function and a risk level per action.' },
  { path: 'app/**/nav.ts', text: 'Optional page titles, aliases and URL state. Pages work without it.' },
  { path: 'saydo.capabilities.json', text: 'Generated lockfile of everything the assistant can do. Review it in pull requests.' },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Saydo is running</p>
        <h1 className="hero-title" tabIndex={-1}>
          {APP_NAME} now does what users ask.
        </h1>
        <p className="hero-sub">
          Press <kbd>⌘K</kbd> (<kbd>Ctrl K</kbd>) and say what you want. The assistant can open any page, read what is on screen, fill in forms and run
          your actions. Anything that changes data waits for your click.
        </p>
        <div className="hero-actions">
          <AskButton primary />
          <a className="button" href={DOCS}>
            Read the docs
          </a>
        </div>
      </section>

      <section className="section" aria-labelledby="try-title">
        <div className="section-head">
          <h2 id="try-title">Try it</h2>
          <p>Click a request to send it, exactly as if you typed it.</p>
        </div>
        <TryIt examples={EXAMPLES} />
        <div className="note">
          <span>
            <strong>On a post:</strong> try <code>archive this</code> (runs with Undo), <code>publish this post</code> (asks first) and{' '}
            <code>delete this post</code> (a full-detail confirm). The post <em>Launch notes</em> contains a prompt injection that tells the
            assistant to delete everything: nothing risky can run without your click.
          </span>
        </div>
      </section>

      <section className="section" aria-labelledby="files-title">
        <div className="section-head">
          <h2 id="files-title">Where things live</h2>
          <p>Everything the assistant can do is in these files.</p>
        </div>
        <div className="files">
          {FILES.map((file) => (
            <div key={file.path} className="file">
              <span className="file-path">{file.path}</span>
              <p>{file.text}</p>
            </div>
          ))}
        </div>
        <div className="links">
          <a href="https://github.com/Ved0715/Saydo#4-actions">Actions →</a>
          <a href="https://github.com/Ved0715/Saydo#2-configure-saydoconfigts">Configuration →</a>
          <a href="https://github.com/Ved0715/Saydo#the-safety-model">Safety model →</a>
        </div>
      </section>
    </>
  );
}
