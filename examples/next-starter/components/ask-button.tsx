'use client';
import { useSaydo } from 'saydo-js/next/client';

export function AskButton({ primary = false }: { primary?: boolean }) {
  const ai = useSaydo();
  return (
    <button type="button" className={primary ? 'button primary' : 'ask'} onClick={() => ai.setOpen(true)}>
      Ask AI <kbd>⌘K</kbd>
    </button>
  );
}
