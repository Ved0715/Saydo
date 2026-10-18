import 'server-only';
import { defineEntity } from 'saydo-js';
import { getPost, listPosts } from '@/lib/db';
import type { PostRecord } from '@/lib/types';

// Day 3: one entity per model. `get` is the authz boundary for every handle.
export const Post = defineEntity<PostRecord>({
  type: 'post',
  describe: 'a blog post the user owns',
  label: (post) => post.title,
  get: (id, { user }) => getPost(id, user.id),
  find: (query, { user }) =>
    listPosts(user.id).filter((p) => p.title.toLowerCase().includes(query.toLowerCase())),
});
