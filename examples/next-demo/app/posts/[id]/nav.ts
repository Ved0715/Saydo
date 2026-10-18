import { defineRoute } from 'saydo';
import { Post } from '@/entities/post';

// Binding [id] to the Post entity makes this route reachable by handle, and
// gives the assistant "this post" (post#1) whenever the user is on it.
export default defineRoute({
  title: 'Post editor',
  params: { id: Post.param() },
});
