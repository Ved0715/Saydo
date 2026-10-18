import 'server-only';
import { z } from 'zod';
import { CapabilityError, defineCapability, navigate, refresh } from 'saydo-js';
import { Post } from '@/entities/post';
import { createPost as insertPost, db, listPosts } from '@/lib/db';

// Day 2: one declaration. Write → confirm card, then navigate to the new draft.
export const createPost = defineCapability({
  id: 'posts.create',
  describe: 'Start a new draft post, optionally with a title',
  input: z.object({ title: z.string().max(200).optional() }),
  risk: 'write',
  handler: ({ title }, ctx) => {
    const id = insertPost(title, ctx.user.id);
    return { result: { id }, effects: [navigate(`/posts/${id}`)] };
  },
});

// Day 3: two fields. Destructive → full-detail confirm (step-up when bulk).
export const deletePosts = defineCapability({
  id: 'posts.delete',
  describe: 'Permanently delete one or more posts',
  input: z.object({ posts: z.array(Post.ref()).min(1).max(50) }),
  risk: 'destructive',
  handler: ({ posts }) => {
    for (const post of posts) db.posts.delete(post.id);
    return { result: { deleted: posts.length }, effects: [navigate('/posts'), refresh()] };
  },
});

// Reversible → runs immediately with an undo token instead of a confirm card.
export const archivePost = defineCapability({
  id: 'posts.archive',
  describe: 'Archive a post (hides it from the list; can be undone)',
  input: z.object({ post: Post.ref() }),
  risk: 'reversible',
  handler: ({ post }) => {
    if (post.archived) throw new CapabilityError('precondition_failed', 'That post is already archived.');
    db.posts.get(post.id)!.archived = true;
    return { effects: [refresh()] };
  },
  undo: ({ post }) => {
    db.posts.get(post.id)!.archived = false;
    return { effects: [refresh()] };
  },
});

// Read → no consent needed.
export const countPosts = defineCapability({
  id: 'posts.count',
  describe: 'Count the user’s posts by status',
  input: z.object({}),
  risk: 'read',
  handler: (_input, ctx) => {
    const posts = listPosts(ctx.user.id);
    return {
      result: {
        total: posts.length,
        published: posts.filter((p) => p.published).length,
        drafts: posts.filter((p) => !p.published && !p.archived).length,
        archived: posts.filter((p) => p.archived).length,
      },
    };
  },
});

// Never offered to the AI: the user does this themselves in Settings.
export const deleteAccount = defineCapability({
  id: 'account.delete',
  describe: 'Delete the user account',
  input: z.object({}),
  risk: 'never',
  handler: () => {
    throw new Error('unreachable');
  },
});
