'use client';
import { use } from 'react';
import { SaydoApproval } from '../react/approval';

/** Ready-made approval page: `export { default } from 'saydo/next/approve'` in app/saydo/approve/[id]/page.tsx. */
export default function SaydoApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 22 }}>Review a request</h1>
      <SaydoApproval grantId={id} />
    </div>
  );
}
