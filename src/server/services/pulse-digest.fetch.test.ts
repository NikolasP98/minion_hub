import { beforeEach, describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { RequestOptions, ClientRequest, IncomingMessage } from 'node:http';
const boundary = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: boundary.lookup }));
vi.mock('node:https', () => ({ request: boundary.request }));
import { fetchDigestSource } from './pulse-digest.fetch';
let answers: { address: string; family: number }[],
  status: number,
  peer: string,
  authorized: boolean,
  chunks: Buffer[],
  stalled: boolean,
  encoding: string | undefined;
type PinnedOptions = RequestOptions & {
  signal: AbortSignal;
  servername: string;
  rejectUnauthorized: boolean;
  lookup: (
    host: string,
    options: { all: true },
    callback: (error: Error | null, addresses?: { address: string; family: number }[]) => void,
  ) => void;
};
beforeEach(() => {
  answers = [{ address: '8.8.8.8', family: 4 }];
  status = 200;
  peer = '8.8.8.8';
  authorized = true;
  chunks = [Buffer.from('[]')];
  stalled = false;
  encoding = undefined;
  boundary.lookup.mockReset();
  boundary.request.mockReset();
  boundary.lookup.mockImplementation(async () => answers);
  boundary.request.mockImplementation(
    (_url: URL, options: PinnedOptions, callback: (res: IncomingMessage) => void) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      let response: Readable | undefined;
      const abort = () => {
        const error = new Error('fixture abort');
        response?.destroy(error);
        req.emit('error', error);
      };
      options.signal.addEventListener('abort', abort, { once: true });
      req.end = () =>
        options.lookup('api.github.com', { all: true }, (error, pins) => {
          if (error) {
            req.emit('error', error);
            return;
          }
          expect(pins).toHaveLength(1);
          response = stalled ? new Readable({ read() {} }) : Readable.from(chunks);
          Object.assign(response, {
            statusCode: status,
            socket: { authorized, remoteAddress: peer },
            headers: encoding ? { 'content-encoding': encoding } : {},
          });
          response.once('close', () => options.signal.removeEventListener('abort', abort));
          callback(response as unknown as IncomingMessage);
        });
      return req as unknown as ClientRequest;
    },
  );
});
const collect = (signal = AbortSignal.timeout(1000)) =>
  fetchDigestSource('https://api.github.com/repos/vercel/ai/releases', { signal });
describe('connection-bound digest HTTPS transport', () => {
  it('pins one address from resolve-all with original TLS hostname certificate checks and no proxy agent', async () => {
    answers.push({ address: '1.1.1.1', family: 4 });
    expect((await collect()).body).toBe('[]');
    expect(boundary.lookup).toHaveBeenCalledWith('api.github.com', { all: true, verbatim: true });
    expect(boundary.request.mock.calls[0][1]).toMatchObject({
      agent: false,
      rejectUnauthorized: true,
      servername: 'api.github.com',
      headers: { 'accept-encoding': 'identity' },
    });
  });
  it('rejects rebinding mixed public-private answers and mismatching actual socket peer before bytes', async () => {
    await collect();
    answers = [{ address: '127.0.0.1', family: 4 }];
    await expect(collect()).rejects.toThrow('nonpublic_dns');
    answers = [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ];
    await expect(collect()).rejects.toThrow('nonpublic_dns');
    answers = [{ address: '8.8.8.8', family: 4 }];
    peer = '1.1.1.1';
    await expect(collect()).rejects.toThrow('peer_mismatch');
  });
  it('rejects redirects unauthorized TLS compressed content and arbitrary protocol or port', async () => {
    status = 302;
    await expect(collect()).rejects.toThrow('status_or_encoding');
    expect(boundary.request).toHaveBeenCalledTimes(1);
    status = 200;
    authorized = false;
    await expect(collect()).rejects.toThrow('peer_mismatch');
    authorized = true;
    encoding = 'gzip';
    await expect(collect()).rejects.toThrow('status_or_encoding');
    await expect(
      fetchDigestSource('http://api.github.com/repos/vercel/ai/releases', {
        signal: AbortSignal.timeout(100),
      }),
    ).rejects.toThrow('source_url');
    await expect(
      fetchDigestSource('https://api.github.com:8443/repos/vercel/ai/releases', {
        signal: AbortSignal.timeout(100),
      }),
    ).rejects.toThrow('source_url');
  });
  it('enforces streaming 1MiB and aborts a stalled body within the caller deadline', async () => {
    chunks = [Buffer.alloc(1048576, 32)];
    expect(Buffer.byteLength((await collect()).body)).toBe(1048576);
    chunks.push(Buffer.from('x'));
    await expect(collect()).rejects.toThrow('body_limit');
    stalled = true;
    const start = performance.now();
    await expect(collect(AbortSignal.timeout(20))).rejects.toThrow('abort');
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
