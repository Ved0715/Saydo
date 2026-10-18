// Framework-agnostic handler (Request → Response) for any fetch-compatible server.
export { createHandler, withGrant, json, type SaydoOptions, type WithGrantOptions, type Registry } from './core/handler';
export { createMcpHandler } from './core/mcp';
