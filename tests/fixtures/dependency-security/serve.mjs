import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const requested = process.env.MINION_DEPENDENCY_OUT;
const runId = process.env.MINION_DEPENDENCY_RUN_ID;
if (!runId) throw new Error('Expected an owned fixture run id');
const shutdownTest = process.env.MINION_DEPENDENCY_SHUTDOWN_TEST === '1';
const port = shutdownTest ? Number(process.env.MINION_DEPENDENCY_PORT ?? '0') : 18904;
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error('Invalid dependency fixture port');
}
const root = requested && fs.existsSync(requested) ? fs.realpathSync(requested) : undefined;
if (!requested || !root || !path.isAbsolute(requested) || root !== path.resolve(requested)) {
  throw new Error('Expected an absolute, non-symlink dependency fixture root');
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = new Map();
for (const item of manifest.files) {
  const file = path.resolve(root, item.path);
  if (!file.startsWith(`${root}${path.sep}`) || fs.realpathSync(file) !== file) {
    throw new Error('Invalid dependency fixture manifest path');
  }
  const body = fs.readFileSync(file);
  if (crypto.createHash('sha256').update(body).digest('hex') !== item.sha256) {
    throw new Error('Dependency fixture artifact changed');
  }
  files.set(`/${item.path.replaceAll(path.sep, '/')}`, body);
}

const server = http.createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(405).end();
    return;
  }
  const pathname = (request.url ?? '').split('?')[0];
  const body = files.get(pathname === '/' ? '/index.html' : pathname);
  if (!body) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'content-type': pathname.endsWith('.js') ? 'text/javascript' : 'text/html',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-minion-fixture-run': runId,
    'content-security-policy':
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'",
  });
  response.end(request.method === 'HEAD' ? undefined : body);
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Dependency fixture address missing');
  console.log(`dependency-security fixture listening 127.0.0.1:${address.port}`);
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  // `server.close()` stops admission, but a Chromium preconnect can remain an
  // established socket without ever sending an HTTP request. Close every owned
  // connection so the child really exits and the runner never needs SIGKILL.
  server.close((error) => {
    if (error) process.exitCode = 1;
  });
  server.closeIdleConnections();
  server.closeAllConnections();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
