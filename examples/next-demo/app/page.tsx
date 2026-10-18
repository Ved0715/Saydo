export default function Home() {
  return (
    <>
      <h1>Acme Posts</h1>
      <p className="lede">
        Press <kbd>⌘K</kbd> (or <kbd>Ctrl K</kbd>) or click <strong>Ask</strong>. Every page is navigable without any
        configuration; actions are declared in <code>capabilities/</code> and gated by risk.
      </p>
      <div className="card">
        <h2>Try</h2>
        <ul className="try">
          <li>
            <code>take me to billing</code>: answered locally, no model call
          </li>
          <li>
            <code>show unpaid invoices</code>: typed URL state (needs a real model)
          </li>
          <li>
            <code>start a new post titled Launch Notes</code>: confirm card, then lands on the draft
          </li>
          <li>
            On a post: <code>open the share dialog</code>, <code>archive this</code> (undo toast), <code>publish this post</code>{' '}
            (client capability + withGrant), <code>delete this post</code> (destructive confirm)
          </li>
          <li>
            Open <em>Launch notes</em>: its body contains a prompt injection. Nothing destructive can happen without your click.
          </li>
        </ul>
      </div>
    </>
  );
}
