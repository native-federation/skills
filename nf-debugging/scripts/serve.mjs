// Static server for NF repros: node serve.mjs 4200:dist/host/browser 4201:dist/mfe1/browser ...
// CORS on (remotes are cross-origin), no caching, SPA fallback to index.html.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.map': 'application/json', '.ico': 'image/x-icon' };

const serve = (root) => async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(root, path.endsWith('/') ? 'index.html' : path);
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  try {
    const body = await readFile(file.startsWith(root) ? file : join(root, 'index.html'));
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    const spa = !extname(path) && (await readFile(join(root, 'index.html')).catch(() => null));
    if (spa) res.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end(spa);
    else res.writeHead(404, headers).end('not found');
  }
};

for (const arg of process.argv.slice(2)) {
  const [port, dir] = arg.split(/:(.*)/s);
  createServer(serve(resolve(dir))).listen(Number(port), () => console.log(`http://localhost:${port} -> ${dir}`));
}
