import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PostEditor } from '@/components/post-editor';
import { getUser } from '@/lib/auth';
import { db, getPost } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function archive(id: string) {
  'use server';
  const user = await getUser();
  const post = getPost(id, user.id);
  if (post) post.archived = !post.archived;
  revalidatePath(`/posts/${id}`);
}

async function remove(id: string) {
  'use server';
  const user = await getUser();
  if (getPost(id, user.id)) db.posts.delete(id);
  redirect('/posts');
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  const post = getPost(id, user.id);
  if (!post) notFound();
  return <PostEditor post={post} archive={archive.bind(null, post.id)} remove={remove.bind(null, post.id)} />;
}
