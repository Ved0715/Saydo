'use client';
import { useState } from 'react';
import { z } from 'zod';
import { useAction, useCapability, useSaydo, useSaydoContext } from 'saydo/next/client';
import { addTask, removeTasks } from '@/capabilities/board';
import { setModelChoice, useModelChoice, type Provider } from '@/lib/model-key';

interface Task {
  id: number;
  title: string;
  done: boolean;
}

const EXAMPLES: Task[] = [
  { id: 1, title: 'Write the launch post', done: false },
  { id: 2, title: 'Record the demo video', done: true },
  { id: 3, title: 'Update the pricing page', done: false },
];

const TRY = ['add a task to email the beta users', 'mark the demo video as not done', 'remove the tasks that are done', 'how do I install Saydo?', 'show me the guide'];

const PROVIDERS: { id: Provider; label: string; placeholder: string }[] = [
  { id: 'demo', label: 'Built-in demo', placeholder: '' },
  { id: 'anthropic', label: 'Anthropic', placeholder: 'claude-haiku-5-5' },
  { id: 'openai', label: 'OpenAI', placeholder: 'gpt-5-mini' },
];

export function Playground() {
  const choice = useModelChoice();
  const ai = useSaydo();
  const [tasks, setTasks] = useState<Task[]>(EXAMPLES);
  const [draft, setDraft] = useState('');

  // The board's abilities: declared once in capabilities/board.ts, implemented here.
  useCapability(addTask, ({ title }) => {
    setTasks((list) => [...list, { id: Date.now(), title, done: false }]);
    return { status: 'ok', message: `Added “${title}”.` };
  });
  useCapability(removeTasks, ({ titles }) => {
    const wanted = new Set(titles.map((t) => t.toLowerCase()));
    setTasks((list) => list.filter((t) => !wanted.has(t.title.toLowerCase())));
    return { status: 'ok', message: `Removed ${titles.length} task${titles.length === 1 ? '' : 's'}.` };
  });
  useAction(
    'board.mark',
    'Mark a task on the playground board as done or not done',
    ({ title, done }) => {
      setTasks((list) => list.map((t) => (t.title.toLowerCase() === title.toLowerCase() ? { ...t, done } : t)));
      return { status: 'ok', message: `Marked “${title}” as ${done ? 'done' : 'not done'}.` };
    },
    { input: z.object({ title: z.string(), done: z.boolean() }) },
  );
  useAction('board.reset', 'Reset the playground board to the example tasks', () => setTasks(EXAMPLES), { phrases: ['reset the board', 'reset board'] });
  useSaydoContext('board', { tasks: tasks.map(({ title, done }) => ({ title, done })) });

  const ask = (text: string) => {
    if (!text.trim()) return;
    void ai.send(text);
    setDraft('');
  };
  const current = PROVIDERS.find((p) => p.id === choice.provider)!;

  return (
    <div className="playground">
      <form className="panel model" onSubmit={(e) => e.preventDefault()} aria-labelledby="model-title">
        <h3 id="model-title">1. Choose a model</h3>
        <div className="segmented" role="radiogroup" aria-label="Provider">
          {PROVIDERS.map((p) => (
            <button
              type="button"
              role="radio"
              aria-checked={choice.provider === p.id}
              key={p.id}
              className={choice.provider === p.id ? 'on' : ''}
              onClick={() => setModelChoice({ provider: p.id })}
            >
              {p.label}
            </button>
          ))}
        </div>
        {choice.provider === 'demo' ? (
          <p className="hint">
            No key needed: a deterministic planner that understands everyday phrasing. Pick a provider to try a real model with your own key.
          </p>
        ) : (
          <>
            <label className="field">
              <span>API key</span>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={choice.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                value={choice.key}
                onChange={(e) => setModelChoice({ key: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Model</span>
              <input id="model-id" spellCheck={false} placeholder={current.placeholder} value={choice.model} onChange={(e) => setModelChoice({ model: e.target.value })} />
            </label>
            <label className="check">
              <input id="remember" type="checkbox" checked={choice.remember} onChange={(e) => setModelChoice({ remember: e.target.checked })} />
              Keep it for this tab
            </label>
            <p className="hint">
              Your key is sent only to this site&apos;s server, with your requests, and is never stored or logged. Use a key with a spending limit.
            </p>
          </>
        )}
      </form>

      <section className="panel board" aria-labelledby="board-title">
        <div className="board-head">
          <h3 id="board-title">2. Tell the board what to do</h3>
          <span className="pill">{choice.provider === 'demo' ? 'demo planner' : choice.key ? `your ${current.label} key` : `${current.label}: add a key`}</span>
        </div>
        <ul className="tasks" aria-label="Launch checklist">
          {tasks.map((task) => (
            <li key={task.id} className={task.done ? 'done' : ''}>
              <label>
                <input type="checkbox" checked={task.done} onChange={() => setTasks((l) => l.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)))} />
                <span>{task.title}</span>
              </label>
              <button type="button" className="remove" data-saydo-risk="destructive" aria-label={`Remove ${task.title}`} onClick={() => setTasks((l) => l.filter((t) => t.id !== task.id))}>
                Remove
              </button>
            </li>
          ))}
          {!tasks.length && <li className="empty">No tasks. Ask for one, or say “reset the board”.</li>}
        </ul>
        <form
          className="prompt"
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <input id="prompt" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask the board… “add a task to email the beta users”" aria-label="Ask the board" />
          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        </form>
        <div className="chips" aria-label="Try">
          {TRY.map((text) => (
            <button type="button" key={text} onClick={() => ask(text)}>
              {text}
            </button>
          ))}
        </div>
        <p className="hint">Adding asks you to confirm, removing shows the exact tasks first, and marking runs at once. Watch the assistant panel.</p>
      </section>
    </div>
  );
}
