import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import type { TLSSocket } from 'node:tls';

function ipv4Public(address: string): boolean {
  const b = address.split('.').map(Number);
  const [a, c] = b;
  return (
    b.length === 4 &&
    b.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a < 224 &&
    !(a === 100 && c >= 64 && c <= 127) &&
    !(a === 169 && c === 254) &&
    !(a === 172 && c >= 16 && c <= 31) &&
    !(a === 192 && (c === 0 || c === 168 || (c === 88 && b[2] === 99))) &&
    !(a === 198 && (c === 18 || c === 19 || (c === 51 && b[2] === 100))) &&
    !(a === 203 && c === 0 && b[2] === 113)
  );
}
function ipv6Words(address: string): number[] | null {
  if (address.includes('%') || isIP(address) !== 6) return null;
  let s = address.toLowerCase();
  if (s.includes('.')) {
    const i = s.lastIndexOf(':');
    const v = s
      .slice(i + 1)
      .split('.')
      .map(Number);
    s =
      s.slice(0, i + 1) +
      ((v[0] << 8) | v[1]).toString(16) +
      ':' +
      ((v[2] << 8) | v[3]).toString(16);
  }
  const parts = s.split('::');
  const left = parts[0] ? parts[0].split(':').map((n) => parseInt(n, 16)) : [];
  const right = parts[1] ? parts[1].split(':').map((n) => parseInt(n, 16)) : [];
  return parts.length === 2
    ? [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right]
    : left;
}
/** Conservative globally routable unicast only; mapped IPv6 is rejected, including public mappings. */
export function isDigestPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return ipv4Public(address);
  const w = ipv6Words(address);
  if (!w || w.length !== 8 || (w[0] & 0xe000) !== 0x2000) return false;
  // IANA special-purpose 2001::/23, documentation 2001:db8::/32 and 3fff::/20.
  return !(
    (w[0] === 0x2001 && w[1] < 0x0200) ||
    (w[0] === 0x2001 && w[1] === 0x0db8) ||
    w[0] === 0x2002 ||
    (w[0] === 0x3fff && w[1] < 0x1000)
  );
}
export type DigestFetchReply = {
  status: 200 | 304;
  body: string;
  etag: string | null;
  lastModified: string | null;
};
export type DigestTransport = (
  url: string,
  options: { signal: AbortSignal; etag?: string | null; lastModified?: string | null },
) => Promise<DigestFetchReply>;
export const fetchDigestSource: DigestTransport = async (endpoint, options) => {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    isIP(url.hostname) ||
    !/^[a-z0-9.-]+$/i.test(url.hostname)
  )
    throw new Error('digest_source_url');
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(10000)]);
  signal.throwIfAborted();
  return new Promise<DigestFetchReply>((resolve, reject) => {
    let pinned: string | undefined;
    const req = request(
      url,
      {
        agent: false,
        rejectUnauthorized: true,
        servername: url.hostname,
        signal,
        headers: {
          accept: 'application/json',
          'accept-encoding': 'identity',
          'user-agent': 'Minion-Pulse-Digest/1',
          ...(options.etag ? { 'if-none-match': options.etag } : {}),
          ...(options.lastModified ? { 'if-modified-since': options.lastModified } : {}),
        },
        lookup: (_hostname, _opts, callback) => {
          void lookup(url.hostname, { all: true, verbatim: true })
            .then((addresses) => {
              signal.throwIfAborted();
              if (!addresses.length || addresses.some((a) => !isDigestPublicAddress(a.address)))
                throw new Error('digest_nonpublic_dns');
              pinned = addresses[0].address;
              // Node may request all answers. Return only the request-local validated pin.
              if (_opts.all) callback(null, [{ address: pinned, family: addresses[0].family }]);
              else callback(null, pinned, addresses[0].family);
            })
            .catch((e: unknown) => callback(e instanceof Error ? e : new Error('digest_dns')));
        },
      },
      (response) => {
        const socket = response.socket as TLSSocket;
        const peer = socket.remoteAddress?.replace(/^::ffff:/, '');
        if (!socket.authorized || !pinned || peer !== pinned || !isDigestPublicAddress(peer)) {
          response.destroy();
          reject(new Error('digest_peer_mismatch'));
          return;
        }
        if (
          ![200, 304].includes(response.statusCode ?? 0) ||
          (response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity')
        ) {
          response.destroy();
          reject(new Error('digest_status_or_encoding'));
          return;
        }
        const length = response.headers['content-length'];
        if (length && (!/^\d+$/.test(length) || Number(length) > 1048576)) {
          response.destroy();
          reject(new Error('digest_body_limit'));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1048576) response.destroy(new Error('digest_body_limit'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            signal.throwIfAborted();
            resolve({
              status: response.statusCode as 200 | 304,
              body: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
              etag:
                typeof response.headers.etag === 'string' && response.headers.etag.length <= 1024
                  ? response.headers.etag
                  : null,
              lastModified:
                typeof response.headers['last-modified'] === 'string' &&
                response.headers['last-modified'].length <= 128
                  ? response.headers['last-modified']
                  : null,
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
};
