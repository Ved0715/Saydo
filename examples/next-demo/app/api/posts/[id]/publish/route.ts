import { withGrant } from 'saydo-js/next/server';
import { publishPost } from '@/capabilities/shared';
import { getUser } from '@/lib/auth';
import { getPost } from '@/lib/db';

// An existing API route. withGrant leaves human requests alone and requires a
// matching single-use grant when the assistant made the call.
export const POST = withGrant(
  publishPost,
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const user = await getUser(request);
    const post = getPost(id, user.id);
    if (!post) return Response.json({ ok: false }, { status: 404 });
    post.published = true;
    return Response.json({ ok: true });
  },
  {
    match: ({ body, args }) =>
      (body as { id?: string })?.id === (args as { post: { id: string } }).post.id,
  },
);
