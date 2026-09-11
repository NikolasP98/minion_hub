import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const hub = fileURLToPath(new URL('../../../', import.meta.url));
const outputBase = fs.realpathSync(path.resolve(hub, '..', 'output'));
const requestedRoot = process.env.MINION_CRITICAL_OUT;
const root = requestedRoot ? fs.realpathSync(requestedRoot) : undefined;
if (!root || !root.startsWith(outputBase + path.sep)) throw Error('Unexpected fixture root');
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
    'content-security-policy':
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'",
  });
  res.end(req.method === 'HEAD' ? undefined : body);
});
server.listen(18903, '127.0.0.1', () => console.log('critical-fixture listening 127.0.0.1:18903'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
