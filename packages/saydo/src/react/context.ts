'use client';
import { createContext, useContext } from 'react';
import type { Registry } from './registry';
import type { SaydoRuntime } from './runtime';

export const RegistryContext = createContext<Registry | null>(null);
export const RuntimeContext = createContext<SaydoRuntime | null>(null);

export function useRegistry(): Registry {
  const registry = useContext(RegistryContext);
  if (!registry) {
    throw new Error('saydo hooks must be used inside <SaydoProvider> (fix: wrap your root layout with it).');
  }
  return registry;
}

export function useRuntime(): SaydoRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) {
    throw new Error('saydo hooks must be used inside <SaydoProvider> (fix: wrap your root layout with it).');
  }
  return runtime;
}
