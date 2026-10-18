import { createHandler, HANDLER_LIMITS, HANDLER_OPTIONS, json, RUNTIME_INIT, type HandlerOptions, type Registry, type Runtime } from './handler';
import type { SaydoConfig } from './config';
import { PROTOCOL_VERSION } from './engine';
import type { InvokeResult } from './protocol';
import type { TurnError } from './protocol';
import type { SaydoUser } from './types';

const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: JsonRpcMessage['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id: JsonRpcMessage['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });

const STATUS_TOOL = {
  name: 'saydo_approval_status',
  title: 'Check an approval',
  description: 'Check whether the user approved a request that needed approval, and get its result.',
  inputSchema: { type: 'object', properties: { grantId: { type: 'string' } }, required: ['grantId'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
const UNDO_TOOL = {
  name: 'saydo_undo',
  title: 'Undo',
  description: 'Undo a reversible action using the undo token it returned.',
  inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

function text(value: unknown, isError = false, structured?: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(structured ? { structuredContent: structured } : {}),
    isError,
  };
}

function toolResult(result: InvokeResult, origin: string) {
  if (!result.ok) return text(`${(result as TurnError).message} ${(result as TurnError).fix}`, true, { status: result.status, code: (result as TurnError).code });
  if (result.status === 'needs_approval') {
    const url = new URL(result.approval.url, origin).toString();
    return text(
      `This needs the user's approval. Ask them to open ${url} to review "${result.approval.view.title}" and approve it in the app, then call saydo_approval_status with {"grantId":"${result.approval.grantId}"}.`,
      false,
      { status: 'needs_approval', grantId: result.approval.grantId, approvalUrl: url, expiresAt: result.approval.expiresAt },
    );
  }
  const { receipt } = result;
  const failed = receipt.status !== 'ok';
  return text(
    { status: receipt.status, message: receipt.message, result: receipt.result, fix: failed ? receipt.fix : undefined, undo: result.undo },
    failed,
    { status: receipt.status, message: receipt.message ?? null, result: (receipt.result as Record<string, unknown> | undefined) ?? null, ...(result.undo ? { undo: result.undo } : {}) },
  );
}

/**
 * MCP server (Streamable HTTP, JSON responses) exposing the actions you mark
 * `expose: { external: true }` to MCP clients such as Claude, Cursor or ChatGPT.
 * Every call runs under the same policy as the in-app assistant; gated calls
 * become a link the user approves in your app (`external.approvals: 'delegated'`).
 */
export function createMcpHandler(registry: Registry, overrides: SaydoConfig = {}) {
  const inner = createHandler(registry, overrides) as ReturnType<typeof createHandler> & Record<symbol, unknown>;
  const init = inner[RUNTIME_INIT] as () => Promise<Runtime | { error: Omit<TurnError, 'ok'> }>;
  const options = inner[HANDLER_OPTIONS] as HandlerOptions;
  const limits = inner[HANDLER_LIMITS] as { limited: (key: string) => Promise<boolean> };

  async function respond(message: JsonRpcMessage, user: SaydoUser, runtime: Runtime, request: Request) {
    const origin = options.external?.appOrigin ?? new URL(request.url).origin;
    const params = message.params ?? {};
    switch (message.method) {
      case 'initialize': {
        const requested = String(params.protocolVersion ?? '');
        return rpcResult(message.id, {
          protocolVersion: MCP_VERSIONS.includes(requested) ? requested : MCP_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: options.appName ?? 'saydo', version: PROTOCOL_VERSION },
          instructions: `Tools that change data may need the user's approval in ${options.appName ?? 'the app'}; when a tool returns needs_approval, share the link with the user and poll saydo_approval_status.`,
        });
      }
      case 'ping':
        return rpcResult(message.id, {});
      case 'tools/list': {
        const tools = await runtime.engine.agentTools(user, 'external');
        const extra = [STATUS_TOOL, ...(tools.some((t) => t.risk === 'reversible') ? [UNDO_TOOL] : [])];
        return rpcResult(message.id, {
          tools: [...tools.map(({ risk: _risk, ...tool }) => tool), ...extra],
        });
      }
      case 'tools/call': {
        const name = String(params.name ?? '');
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        if (await limits.limited(user.id)) return rpcResult(message.id, text('Too many requests. Wait a minute and try again.', true));
        if (name === STATUS_TOOL.name) {
          const status = await runtime.engine.grantStatus(user, String(args.grantId ?? ''));
          return rpcResult(message.id, status.ok ? text({ state: status.state, receipt: status.receipt }, false, { state: status.state, status: status.receipt?.status ?? null, message: status.receipt?.message ?? null, result: (status.receipt?.result as Record<string, unknown>) ?? null }) : text(status.message, true));
        }
        if (name === UNDO_TOOL.name) {
          const result = await runtime.engine.handle({ type: 'undo', token: String(args.token ?? ''), client: { route: '/', tabId: 'external', mounted: [], uiActions: [] } }, user, { request });
          return rpcResult(message.id, result.ok ? text('Undone.') : text(`${result.message} ${result.fix}`, true));
        }
        return rpcResult(message.id, toolResult(await runtime.engine.invoke(user, { tool: name, args, origin: 'external', request }), origin));
      }
      default:
        return rpcError(message.id, -32601, `Method not found: ${message.method}`);
    }
  }

  async function POST(request: Request): Promise<Response> {
    const authenticate = options.external?.authenticate;
    if (!authenticate) {
      return json({ error: 'MCP is not enabled. Set external.authenticate in saydo.config.ts.' }, 404);
    }
    const user = await authenticate(request);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
      });
    }
    let payload: JsonRpcMessage | JsonRpcMessage[];
    try {
      payload = await request.json();
    } catch {
      return json(rpcError(null, -32700, 'Parse error'), 400);
    }
    const ready = await init();
    if ('error' in ready) return json(rpcError(null, -32603, `${ready.error.message} ${ready.error.fix}`), 500);
    const messages = Array.isArray(payload) ? payload : [payload];
    const responses = [];
    for (const message of messages) {
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        responses.push(rpcError(message?.id, -32600, 'Invalid request'));
        continue;
      }
      if (message.id === undefined) continue; // notification
      try {
        responses.push(await respond(message, user, ready, request));
      } catch (error) {
        console.error('[saydo] MCP request failed', error);
        responses.push(rpcError(message.id, -32603, 'Internal error'));
      }
    }
    if (!responses.length) return new Response(null, { status: 202 });
    return json(Array.isArray(payload) ? responses : responses[0]);
  }

  /** This server is stateless and does not offer a server-to-client stream. */
  const GET = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
  return { POST, GET, DELETE: GET };
}
