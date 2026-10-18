import { z } from 'zod';
import { defineCapability, entityRef } from 'saydo-js';
import type { PostRecord } from '@/lib/types';

/**
 * A client capability: no server handler. The post page implements it with
 * useCapability by reusing its existing publish API call, which is wrapped in
 * withGrant. This file is imported by the browser, so it uses entityRef (type
 * name only) instead of Post.ref(), which would pull in database code.
 */
export const publishPost = defineCapability({
  id: 'posts.publish',
  describe: 'Publish a post so readers can see it',
  input: z.object({ post: entityRef<PostRecord>('post') }),
  risk: 'write',
  entry: '/posts/[id]',
});
