import * as registry from 'saydo-js/registry';
import { createHandler } from '../core/handler';

/**
 * Zero-boilerplate route: configuration comes from saydo.config.ts.
 *
 *   // app/api/saydo/route.ts
 *   export { POST } from 'saydo-js/next/route';
 */
export const POST = createHandler(registry);
