'use client';
import { useSaydo } from 'saydo-js/next/client';

export function AskButton() {
  const ai = useSaydo();
  return (
    <button type="button" className="ask-button" onClick={() => ai.setOpen(true)}>
      Ask this site <kbd>⌘K</kbd>
    </button>
  );
}
