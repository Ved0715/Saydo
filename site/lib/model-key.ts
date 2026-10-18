'use client';
import { useSyncExternalStore } from 'react';

export type Provider = 'demo' | 'anthropic' | 'openai';
export interface ModelChoice {
  provider: Provider;
  key: string;
  model: string;
  remember: boolean;
}

const STORAGE = 'saydo-site-model';
const initial: ModelChoice = { provider: 'demo', key: '', model: '', remember: false };
let choice: ModelChoice = initial;
let loaded = false;
const listeners = new Set<() => void>();

// The key lives in memory, or in this tab's sessionStorage when the visitor asks; never in localStorage.
function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const saved = sessionStorage.getItem(STORAGE);
    if (saved) choice = { ...initial, ...(JSON.parse(saved) as Partial<ModelChoice>), remember: true };
  } catch {
    // storage blocked: memory only
  }
}

export function setModelChoice(patch: Partial<ModelChoice>) {
  load();
  choice = { ...choice, ...patch };
  try {
    if (choice.remember) sessionStorage.setItem(STORAGE, JSON.stringify(choice));
    else sessionStorage.removeItem(STORAGE);
  } catch {
    // storage blocked: memory only
  }
  for (const listener of listeners) listener();
}

export function useModelChoice(): ModelChoice {
  return useSyncExternalStore(
    (listener) => {
      load();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => {
      load();
      return choice;
    },
    () => initial,
  );
}

/** Headers for the Saydo endpoint: the planner on the server reads them for this request only. */
export function modelHeaders(): Record<string, string> {
  load();
  if (choice.provider === 'demo') return { 'x-saydo-provider': 'demo' };
  return {
    'x-saydo-provider': choice.provider,
    ...(choice.key.trim() ? { 'x-saydo-key': choice.key.trim() } : {}),
    ...(choice.model.trim() ? { 'x-saydo-model': choice.model.trim() } : {}),
  };
}
