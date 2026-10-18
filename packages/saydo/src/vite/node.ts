import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type FetchHandler = (request: Request) => Response | Promise<Response>;

const trustedClientIps = () =>
  ((globalThis as Record<symbol, WeakMap<Request, string>>)[Symbol.for('saydo.client-ip')] ??= new WeakMap<Request, string>());

/** Adapt a fetch-style handler (Request → Response) to Node's http/Express/connect. */
export function toNodeHandler(handler: FetchHandler) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
    const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0];
    const url = new URL(req.url ?? '/', `${proto}://${req.headers.host ?? 'localhost'}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const method = req.method ?? 'GET';
    const request = new Request(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
    });
    // The socket address is the only client IP a raw Node server can trust. It travels beside the
    // Request (never as a header a client could forge).
    if (req.socket?.remoteAddress) trustedClientIps().set(request, req.socket.remoteAddress);
    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') res.setHeader(key, value);
    });
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) res.setHeader('set-cookie', cookies);
    if (!response.body) return void res.end();
    // Stream (streamed assistant replies arrive as they are written).
    res.flushHeaders?.();
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
    res.end();
  };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/** Minimal static server for a built SPA, with index.html fallback for client routes. */
export function serveStatic(dir: string | URL, options: { agents?: boolean; permissionsPolicy?: boolean } = {}) {
  const root = path.resolve(typeof dir === 'string' ? dir : fileURLToPath(dir));
  return (req: IncomingMessage, res: ServerResponse) => {
    // WebMCP's "tools" feature: off unless the app uses browser agents (then own origin only).
    if (options.permissionsPolicy !== false) res.setHeader('Permissions-Policy', options.agents ? 'tools=(self)' : 'tools=()');
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = path.join(root, pathname);
    if (!file.startsWith(root)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  };
}
