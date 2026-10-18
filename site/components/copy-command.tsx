'use client';
import { useRef, useState } from 'react';

export function CopyCommand({ command }: { command: string }) {
  const [label, setLabel] = useState('Copy');
  const code = useRef<HTMLElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setLabel('Copied');
    } catch {
      const range = document.createRange();
      if (code.current) range.selectNodeContents(code.current);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      setLabel('Selected');
    }
    setTimeout(() => setLabel('Copy'), 1600);
  };
  return (
    <div className="command">
      <span className="command-prompt" aria-hidden="true">$</span>
      <code ref={code}>{command}</code>
      <button type="button" className="command-copy" onClick={copy} aria-label={`Copy: ${command}`}>
        {label}
      </button>
    </div>
  );
}
