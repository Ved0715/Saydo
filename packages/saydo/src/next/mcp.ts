import * as registry from 'saydo-js/registry';
import { createMcpHandler } from '../core/mcp';

/**
 * MCP endpoint for external agents:
 *
 *   // app/api/saydo/mcp/route.ts
 *   export { POST, GET, DELETE } from 'saydo-js/next/mcp';
 */
const handler = createMcpHandler(registry);
export const POST = handler.POST;
export const GET = handler.GET;
export const DELETE = handler.DELETE;
