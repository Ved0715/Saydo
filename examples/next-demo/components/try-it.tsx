'use client';
import { useSaydo } from 'saydo-js/next/client';

export interface Example {
  say: string;
  badge: string;
  tone?: 'instant' | 'asks' | 'danger';
  what: string;
}

/** Example requests: clicking one opens the assistant and sends it, exactly as if typed. */
export function TryIt({ examples }: { examples: Example[] }) {
  const ai = useSaydo();
  return (
    <div className="try-grid">
      {examples.map((example) => (
        <button
          key={example.say}
          type="button"
          className="try-card"
          onClick={() => {
            ai.setOpen(true);
            void ai.send(example.say);
          }}
        >
          <span className={`badge ${example.tone ?? ''}`}>{example.badge}</span>
          <span className="try-say">{example.say}</span>
          <span className="try-what">{example.what}</span>
        </button>
      ))}
    </div>
  );
}
