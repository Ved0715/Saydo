import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { createPost } from '@/lib/db';

// The human path for the same action the assistant can take ("no AI-only capabilities").
async function create(formData: FormData) {
  'use server';
  const user = await getUser();
  const id = createPost(String(formData.get('title') ?? ''), user.id);
  redirect(`/posts/${id}`);
}

export default function NewPost() {
  return (
    <>
      <h1>New post</h1>
      <form action={create} className="stack card">
        <label>
          Title
          <input type="text" name="title" placeholder="Launch Notes" />
        </label>
        <div>
          <button className="primary" type="submit">
            Create draft
          </button>
        </div>
      </form>
    </>
  );
}
