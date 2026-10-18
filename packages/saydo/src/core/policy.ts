import type { Risk, Tier } from './types';

export interface PolicyOptions {
  /** Destructive calls touching more records than this need step-up. */
  bulkThreshold?: number;
}

/** Largest array length among the top-level input fields (a proxy for blast radius). */
export function bulkCount(args: unknown): number {
  if (!args || typeof args !== 'object') return 1;
  let max = 1;
  for (const value of Object.values(args as Record<string, unknown>)) {
    if (Array.isArray(value)) max = Math.max(max, value.length);
  }
  return max;
}

/**
 * Risk + arguments → consent tier. Runs only on the server, from the server's
 * own import of the capability; the client never gets to say what is dangerous.
 */
export function tierFor(risk: Risk, args: unknown, options: PolicyOptions = {}): Tier {
  const threshold = options.bulkThreshold ?? 5;
  switch (risk) {
    case 'read':
      return 0;
    case 'reversible':
      return 1;
    case 'write':
      return 2;
    case 'destructive':
      return bulkCount(args) > threshold ? 3 : 2;
    case 'never':
      return 4;
  }
}

/** Map our risk vocabulary onto MCP / WebMCP annotation hints for emission. */
export function annotationsFor(risk: Risk) {
  return {
    readOnlyHint: risk === 'read',
    destructiveHint: risk === 'destructive' || risk === 'never',
    idempotentHint: risk === 'read',
    consequentialHint: risk === 'write' || risk === 'destructive' || risk === 'never',
  };
}
