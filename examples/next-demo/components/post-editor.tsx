'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { CapabilityError } from 'saydo-js';
import { useAction, useSaydoContext, useCapability } from 'saydo-js/next/client';
import { publishPost } from '@/capabilities/shared';
import type { PostRecord } from '@/lib/types';

export function PostEditor({
  post,
  archive,
  remove,
}: {
  post: PostRecord;
  archive: () => Promise<void>;
  remove: () => Promise<void>;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [publishing, setPublishing] = useState(false);

  // The existing publish call your UI already makes (the human path).
  async function publish(fetcher: typeof fetch = fetch) {
    setPublishing(true);
    try {
      const response = await fetcher(`/api/posts/${post.id}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: post.id }),
      });
      if (!response.ok) throw new CapabilityError('error', 'Publishing failed on the server.');
      router.refresh();
    } finally {
      setPublishing(false);
    }
  }

  // UI action: one line, tier 0.
  useAction('share.open', 'Open the share dialog for this post', () => dialog.current?.showModal());

  // Client capability: reuse the same call. ctx.fetch carries the single-use grant to withGrant.
  useCapability(publishPost, async (_input, ctx) => {
    await publish(ctx.fetch);
    return { status: 'ok', message: 'Published.' };
  });

  // Opt-in, minimal context. Never pass whole records.
  useSaydoContext('post', { status: post.published ? 'published' : post.archived ? 'archived' : 'draft' });

  return (
    <article className="stack">
      <div className="row">
        <h1>{post.title}</h1>
        <span className={`pill ${post.published ? 'ok' : ''}`}>
          {post.archived ? 'archived' : post.published ? 'published' : 'draft'}
        </span>
      </div>
      {/* User-written content: readable as untrusted data; nothing inside can become an action. */}
      <pre data-saydo-untrusted>{post.body || 'Empty draft.'}</pre>
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <button type="button" onClick={() => dialog.current?.showModal()}>
          Share
        </button>
        <button type="button" className="primary" disabled={post.published || publishing} onClick={() => publish()}>
          {post.published ? 'Published' : publishing ? 'Publishing…' : 'Publish'}
        </button>
        <form action={archive}>
          <button type="submit">{post.archived ? 'Unarchive' : 'Archive'}</button>
        </form>
        <form action={remove}>
          <button type="submit" className="danger">
            Delete
          </button>
        </form>
      </div>
      <dialog ref={dialog} aria-label="Share">
        <h2 style={{ marginTop: 0 }}>Share “{post.title}”</h2>
        <p>
          <code>https://acme.example/p/{post.id}</code>
        </p>
        <form method="dialog">
          <button type="submit">Close</button>
        </form>
      </dialog>
    </article>
  );
}
