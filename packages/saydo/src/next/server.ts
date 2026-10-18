import * as registry from 'saydo-js/registry';
import { createHandler, type SaydoOptions } from '../core/handler';

/**
 * The whole assistant backend in one export:
 *
 *   // app/api/saydo/route.ts
 *   export const POST = createSaydoHandler({ model: anthropic('claude-sonnet-5-5') });
 *
 * Routes and capabilities come from the registry withSaydo() generates.
 */
export function createSaydoHandler(options: SaydoOptions = {}) {
  return createHandler(registry, options);
}

export { withGrant, createHandler, GRANT_HEADER, type SaydoOptions, type WithGrantOptions } from '../core/handler';
export { CapabilityError } from '../core/index';
