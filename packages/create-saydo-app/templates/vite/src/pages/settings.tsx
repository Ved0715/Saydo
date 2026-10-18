import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { useAction } from 'saydo/react-router';

export function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'general';
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // One line exposes a UI change with typed input. Tier 0: no confirmation.
  useAction('theme.set', 'Switch the color theme (light or dark)', ({ theme }) => setTheme(theme), {
    input: z.object({ theme: z.enum(['light', 'dark']) }),
  });

  return (
    <>
      <h1>Settings</h1>
      <div role="tablist" className="row" style={{ justifyContent: 'flex-start' }}>
        <button role="tab" aria-selected={tab === 'general'} onClick={() => setParams({ tab: 'general' })}>General</button>
        <button role="tab" aria-selected={tab === 'notifications'} onClick={() => setParams({ tab: 'notifications' })}>Notifications</button>
      </div>
      {tab === 'general' ? (
        <div className="card">
          <p>Theme: <strong>{theme}</strong></p>
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>Toggle theme</button>
        </div>
      ) : (
        <div className="card">
          <label><input type="checkbox" defaultChecked /> Product updates</label>
        </div>
      )}
    </>
  );
}
