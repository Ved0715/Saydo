// Production server for the SPA: static files + the Saydo endpoint.
// Built with `vite build --ssr server.ts`, so the virtual registry is bundled in.
import http from 'node:http';
import { POST } from 'virtual:saydo/handler';
import { serveStatic, toNodeHandler } from 'saydo-js/node';

const api = toNodeHandler(POST);
const files = serveStatic(new URL('../dist', import.meta.url));
const port = Number(process.env.PORT ?? 4173);

http
  .createServer((req, res) => (req.method === 'POST' && req.url?.startsWith('/api/saydo') ? api(req, res) : files(req, res)))
  .listen(port, () => console.log(`Saydo React demo on http://localhost:${port}`));
