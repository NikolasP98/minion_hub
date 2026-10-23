import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const requestedRoot = process.env.MINION_CRITICAL_OUT;
const runId = process.env.MINION_CRITICAL_RUN_ID;
if (!runId) throw Error('Expected an owned fixture run id');
const root = requestedRoot ? fs.realpathSync(requestedRoot) : undefined;
if (
  !root ||
  !requestedRoot ||
  !path.isAbsolute(requestedRoot) ||
  root !== path.resolve(requestedRoot)
)
  throw Error('Expected an absolute, non-symlink fixture root');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = new Map();
for (const item of manifest.files) {
  const file = path.resolve(root, item.path);
  if (!file.startsWith(root + '/') || fs.realpathSync(file) !== file)
    throw Error('Invalid manifest path');
  const body = fs.readFileSync(file);
  if (crypto.createHash('sha256').update(body).digest('hex') !== item.sha256)
    throw Error('Changed artifact');
  files.set('/' + item.path, body);
}
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method ?? '')) {
    res.writeHead(405).end();
    return;
  }
  const pathname = (req.url ?? '').split('?')[0];
  const body = files.get(pathname);
  if (!body) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'content-type': types[path.extname(pathname)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-minion-fixture-run': runId,
    'content-security-policy':
      // The actual Carta/Shiki renderer instantiates its bundled Oniguruma Wasm.
      // Permit that fixture dependency while keeping JavaScript eval forbidden.
      "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'",
  });
  res.end(req.method === 'HEAD' ? undefined : body);
});
const requestedPort =
  process.env.MINION_CRITICAL_PORT === undefined ? 18903 : Number(process.env.MINION_CRITICAL_PORT);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535)
  throw Error('Invalid private fixture port');
server.listen(requestedPort, '127.0.0.1', () =>
  console.log(JSON.stringify({ fixturePort: server.address().port })),
);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
