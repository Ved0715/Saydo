import Link from 'next/link';
import { getUser } from '@/lib/auth';
import { listPosts } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Posts() {
  const user = await getUser();
  const posts = listPosts(user.id).filter((p) => !p.archived);
  return (
    <>
      <div className="row">
        <h1>Posts</h1>
        <Link href="/posts/new" className="button primary">
          New post
        </Link>
      </div>
      <div className="stack">
        {posts.map((post) => (
          <Link key={post.id} href={`/posts/${post.id}`} className="card row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span>{post.title}</span>
            <span className={`pill ${post.published ? 'ok' : ''}`}>{post.published ? 'published' : 'draft'}</span>
          </Link>
        ))}
        {!posts.length && <p className="lede">No posts yet.</p>}
      </div>
    </>
  );
}
