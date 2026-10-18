import * as registry from 'saydo/registry';
import { createHandler } from '../core/handler';

/**
 * Zero-boilerplate route: configuration comes from saydo.config.ts.
 *
 *   // app/api/saydo/route.ts
 *   export { POST } from 'saydo/next/route';
 */
export const POST = createHandler(registry);
