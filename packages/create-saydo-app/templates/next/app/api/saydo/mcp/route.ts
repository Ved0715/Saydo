// MCP server for agents outside the app (Claude, ChatGPT, Cursor). It stays off (404)
// until `external.authenticate` is set in saydo.config.ts.
export { POST, GET, DELETE } from 'saydo/next/mcp';
